import { createHash } from 'node:crypto'
import type {
	FlagReason,
	IReplayLogRepository,
	LobbyRunStatus,
	RunRow,
	RunWithLogs,
} from '../../contracts/IReplayLogRepository.js'
import * as replayLogGateway from '../../infrastructure/gateways/replay-log.gateway.js'
import { enqueueServiceQueueItem } from '../../infrastructure/gateways/service-queue.gateway.js'
import { compressToBase64 } from '../../shared/utils/compression.js'
import { AppError } from '../../shared/utils/errors.js'
import { getLobby } from '../../state/index.js'
import { matchByLobby } from '../../state/matchmaking.js'

// Indefinite (NULL expiresAt) is reserved for flagged/disputed runs -- see
// finalizeRun's flags param, set by matchmaking.service.ts's evaluateAntiCheat.
const RUN_TTL_MS = 180 * 24 * 60 * 60 * 1000

// Framing opcodes excluded from the anti-cheat hash input on both sides.
// Only 'end'/'chk' now -- match_manifest/lobby_info/run_info (see
// BalatroMultiplayerAPI's api/replay/framing_codes.lua) are ordinary
// MPAPI.RLOG_CODE-recorded events like any other opcode, so (unlike the old
// single 'manifest' event, which bypassed RLOG.record via emit_carbon
// directly) they DO participate in the hash now -- a tampered seed/deck/
// stake is caught the same way a tampered play/buy/sell would be. 'end'/
// 'chk' remain excluded: 'end' carries the outcome the hash itself is meant
// to attest to, and 'chk' IS the hash.
const FRAMING_OPCODES = new Set(['end', 'chk'])

// Mirrors api/replay/recorder.lua's canonical_hash_input/encode_event_tuple:
// gameplay events only, encoded as [t, opcode, args] positional tuples (array
// order is unambiguous in JSON, sidestepping any Lua/JS key-order mismatch a
// dict-shaped encoding would risk) -- so this must stay byte-for-byte aligned
// with the Lua side's encoding rules, not just "produce valid JSON".
//
// Schema v2 (RLOG.SCHEMA_VERSION, api/replay/recorder.lua): card-referencing
// opcodes (play, discard, sell, buy/open_pack/voucher, pack_pick/use,
// pack_skip, reorder) carry full card identity inline via RLOG.card_ref, so
// `args` is opaque to this function but not to a human/tooling reader of the
// stored log. A per-card reference is a JSON array whose FIRST element's sign
// disambiguates the two shapes:
//   already-seen : [ id, tag, tag, ... ]                  -- id > 0, this
//                  card's identity was already sent earlier in the stream
//                  under this id
//   first-seen   : [ -id, kind, ident..., tag, tag, ... ]  -- id encoded
//                  negative; kind is "pc" (playing card, ident = suit, value)
//                  or Balatro's native ability.set ("Joker"/"Tarot"/"Planet"/
//                  "Spectral"/"Voucher", ident = SMODS center key)
// `tag...` (0-3 elements, on every reference, since enhancement/edition/seal
// can mutate mid-run): "e:"+enhancement key (playing cards only, omitted when
// none), "ed:"+edition type (omitted when none), "s:"+seal (playing cards
// only, omitted when none). Card ids are scoped to a single run (reset each
// begin_run), assigned in first-reference order -- there is no separate
// dictionary event; identity is always inline on first use.
function canonicalHashInput(events: readonly LogEvent[]): string {
	const tuples = events
		.filter((e) => !FRAMING_OPCODES.has(e.opcode))
		.map((e) => [e.t, e.opcode, e.args ?? null])
	return JSON.stringify(tuples)
}

export interface LogEvent {
	t: number
	opcode: string
	args?: unknown
}

// lobby_info's args (see api/replay/framing_codes.lua) -- gamemode/ruleset
// only; players/decks/options aren't needed for a spectator bootstrap.
function isLobbyInfoArgs(args: unknown): args is { gamemode: string; ruleset: string } {
	if (!args || typeof args !== 'object') return false
	const a = args as Record<string, unknown>
	return typeof a.gamemode === 'string' && typeof a.ruleset === 'string'
}

// run_info's args (see api/replay/framing_codes.lua) -- what a seeded local
// run bootstrap (PVP._start_playback/SPDRN._start_playback) actually needs.
function isRunInfoArgs(args: unknown): args is { seed: string; deck: string; stake?: number } {
	if (!args || typeof args !== 'object') return false
	const a = args as Record<string, unknown>
	return typeof a.seed === 'string' && typeof a.deck === 'string'
}

interface PlayerBuffer {
	events: LogEvent[]
	carbonHash: string | null
}

interface RunBuffer {
	runId: string
	players: Map<string, PlayerBuffer>
}

// §22.3 full-fidelity spectate: the fields a client needs to bootstrap a
// seeded local run (PVP._start_playback/SPDRN._start_playback) that
// reproduces this player's exact cards -- merged from lobby_info (gamemode/
// ruleset, plus sleeve/challenge riding in PvP's own options dict, see
// networking/action_handlers.lua's action_start_game) and the LAST-seen
// run_info (not first: a spectator joining mid-match during a later run of a
// multi-run match needs the CURRENT run's seed/deck/stake, not the first
// one's -- see api/replay/framing_codes.lua).
export interface SpectatorManifest {
	seed: string
	deck: string
	sleeve: string | null
	challenge: string | null
	ruleset: string
	gamemode: string
	stake: number | null
}

export interface SpectatorSnapshotEntry {
	playerId: string
	ante: string | null
	score: string | null
	handsRemaining: number | null
	manifest: SpectatorManifest | null
}

interface ReplayLogServiceDeps {
	repository: IReplayLogRepository
}

export type ReplayLogService = ReturnType<typeof createReplayLogService>

// Buffers every player's `pvp_log_event` stream (see BalatroMultiplayerPvP's
// lib/replay_log.lua / pvp_api/replay_log_actions.lua) in memory, keyed by
// lobby code, and flushes it to matchRunLogs once the run ends -- whether that
// end is a clean result report or an abandoned/terminated lobby. This is the
// server-side half of Phase 3's transport; nothing else in this repo ever
// subscribed to MQTT before this.
export function createReplayLogService(deps: ReplayLogServiceDeps) {
	const { repository } = deps
	const runs = new Map<string, RunBuffer>()
	// Host and guest each broadcast their own `manifest` event at match start,
	// arriving as two near-simultaneous MQTT messages -- without memoizing the
	// in-flight creation, both would see `runs.get(lobbyCode)` as unset (the
	// `await insertRun` below hasn't resolved yet) and each insert their own
	// lobby_runs row, orphaning one of them.
	const pendingRunCreation = new Map<string, Promise<RunBuffer | null>>()

	async function handleActionLogEvent(
		lobbyCode: string,
		playerId: string,
		params: Record<string, unknown>,
	): Promise<void> {
		if (typeof params.t !== 'number' || typeof params.opcode !== 'string')
			return
		const event: LogEvent = {
			t: params.t,
			opcode: params.opcode,
			args: params.args,
		}

		let run = runs.get(lobbyCode)
		if (!run) {
			let pending = pendingRunCreation.get(lobbyCode)
			if (!pending) {
				pending = (async () => {
					const lobby = getLobby(lobbyCode)
					if (!lobby) return null // lobby already gone -- nothing to anchor this run to

					// matchByLobby only holds ranked+casual matchmaking matches (see
					// grace-period.service.ts's own comment on the same lookup) --
					// undefined here for a practice/private lobby, which correctly
					// leaves matchmakingMatchId null for those. Previously always
					// null regardless: nothing ever populated this column despite it
					// existing in the schema specifically for this join, which is
					// exactly what left the admin Match History page with no way to
					// link a match row to its RLOG run.
					const runId = await repository.insertRun({
						lobbyCode,
						modId: lobby.modId,
						lobbyType: lobby.type,
						matchmakingMatchId: matchByLobby.get(lobbyCode)?.matchId ?? null,
					})
					const created: RunBuffer = { runId, players: new Map() }
					runs.set(lobbyCode, created)
					return created
				})()
				pendingRunCreation.set(lobbyCode, pending)
			}
			run = (await pending) ?? undefined
			pendingRunCreation.delete(lobbyCode)
			if (!run) return
		}

		let playerBuf = run.players.get(playerId)
		if (!playerBuf) {
			playerBuf = { events: [], carbonHash: null }
			run.players.set(playerId, playerBuf)
		}
		playerBuf.events.push(event)

		if (
			event.opcode === 'chk' &&
			event.args &&
			typeof event.args === 'object'
		) {
			const carbon = (event.args as { carbon?: unknown }).carbon
			if (typeof carbon === 'string') playerBuf.carbonHash = carbon
		}
	}

	// Idempotent: a run already flushed (buffer cleared) is a no-op, so both a
	// clean "reportResult" hook and a later lobby-closed cleanup hook can call
	// this for the same lobby without double-writing.
	//
	// `flags`, when given, must be evaluated (verifyPlayerHash/
	// countHandResultEvents) BEFORE this is called -- the buffer these read
	// from is gone the moment finalizeRun returns.
	async function finalizeRun(
		lobbyCode: string,
		status: LobbyRunStatus,
		flags?: ReadonlyMap<string, FlagReason>,
	): Promise<void> {
		const run = runs.get(lobbyCode)
		if (!run) return
		runs.delete(lobbyCode)

		const playerStatus = status === 'completed' ? 'complete' : 'partial'

		for (const [playerId, buf] of run.players) {
			const flagReason = flags?.get(playerId) ?? null
			// A flagged row gets indefinite retention (mirrors the existing
			// reports/flaggedMessages "null expiresAt = keep" convention) instead
			// of the normal 30-day TTL, since it's a candidate for moderator review.
			const expiresAt =
				flagReason !== null ? null : new Date(Date.now() + RUN_TTL_MS)
			await repository.upsertPlayerLog({
				runId: run.runId,
				playerId,
				// Stored as [t, opcode, args] positional tuples -- the same shape
				// canonicalHashInput already converts to for hashing (and what the
				// client's own canonical_hash_input/encode_event_tuple broadcasts
				// were always meant to mirror) -- not the raw {t, opcode, args}
				// LogEvent objects buf.events holds in memory. MPAPI.playback.build_timeline
				// (BalatroMultiplayerAPI/api/playback/timeline.lua) reads ev[1]/ev[2]/ev[3]
				// positionally, so storing the object shape here left every downloaded
				// replay's timeline silently empty (event.opcode being undefined
				// each time, since there is no [1] key on an object) -- confirmed live.
				compressedEvents: compressToBase64(
					JSON.stringify(buf.events.map((e) => [e.t, e.opcode, e.args ?? null])),
				),
				carbonHash: buf.carbonHash,
				eventCount: buf.events.length,
				status: playerStatus,
				flagReason,
				expiresAt,
			})

			if (flagReason !== null) {
				await enqueueServiceQueueItem({
					itemType: 'anti_cheat',
					sourceId: run.runId,
					subjectPlayerId: playerId,
					summary: `Anti-cheat flag (${flagReason})`,
				})
			}
		}

		await repository.updateRunStatus(run.runId, status)
	}

	function hasBufferedRun(lobbyCode: string): boolean {
		return runs.has(lobbyCode)
	}

	// Phase 8: recomputes the SHA-256 the client itself submitted (verbatim,
	// off the live 'chk' event) over the server's own buffered events and
	// compares. 'unavailable' when there's no buffer for this player or the
	// client never reached end_run (e.g. disconnected mid-match before the
	// CHK trailer broadcast) -- distinct from 'mismatch' so a caller doesn't
	// flag a run for a reason that isn't actually evidence of tampering.
	function verifyPlayerHash(
		lobbyCode: string,
		playerId: string,
	): 'match' | 'mismatch' | 'unavailable' {
		const buf = runs.get(lobbyCode)?.players.get(playerId)
		if (!buf || buf.carbonHash === null) return 'unavailable'
		const recomputed = createHash('sha256')
			.update(canonicalHashInput(buf.events))
			.digest('hex')
		return recomputed === buf.carbonHash ? 'match' : 'mismatch'
	}

	// Phase 8: count of the player's own buffered 'hand_result' events, the
	// basis for the elapsed-time plausibility gate (MIN_MS_PER_HAND *
	// count(hand_result) must not exceed the match's real elapsed time).
	function countHandResultEvents(lobbyCode: string, playerId: string): number {
		const buf = runs.get(lobbyCode)?.players.get(playerId)
		if (!buf) return 0
		return buf.events.filter((e) => e.opcode === 'hand_result').length
	}

	// Phase 9: GET /api/runs/:lobbyCode/players/:playerId/tail?since_t=N.
	// Reads the LIVE in-memory buffer, not the DB -- unlike getReplay, this
	// serves a still-active match (there's no matchRunLogs row yet, or it's
	// stale). A reconnecting client uses this to catch up on the opponent's
	// pvp_log_event broadcasts it missed while disconnected (MQTT doesn't
	// backlog non-retained topic messages). Returns [] for a lobby with no
	// buffered run, or a player with none of their own -- not an error, since
	// "nothing missed yet" is a normal outcome, not a failure.
	function getTail(
		lobbyCode: string,
		playerId: string,
		sinceT: number,
	): LogEvent[] {
		const buf = runs.get(lobbyCode)?.players.get(playerId)
		if (!buf) return []
		return buf.events.filter((e) => e.t > sinceT)
	}

	// Phase 6: GET /api/runs/:runId/replay. Restricted to the run's own
	// participants -- there's no broader "public replay" access tier designed
	// yet, so this is the conservative default. isModerator (resolved by the
	// route from the requester's DB-stored privileges, same check webAdmin's
	// middleware uses) bypasses the participant check, so a moderator can open
	// the replay linked from a player report even when they weren't in the match.
	async function getReplay(
		runId: string,
		requesterId: string,
		isModerator = false,
	): Promise<RunWithLogs> {
		const result = await repository.getRunWithLogs(runId)
		if (!result) throw new AppError('Run not found', 404)
		if (!isModerator && !result.logs.some((log) => log.playerId === requesterId)) {
			throw new AppError('Not a participant in this run', 403)
		}
		return result
	}

	// §22.2: the discovery step a client-side "My Matches" replay list needs --
	// previously nothing let a player find their own past run ids at all
	// (getMostRecentRunForLobbyCode serves report-filing only, not browsing).
	async function listMyRuns(
		playerId: string,
		page = 1,
		pageSize = 20,
	): Promise<{ runs: RunRow[]; total: number; page: number; pageSize: number }> {
		const { runs, total } = await repository.getRunsForPlayer(playerId, page, pageSize)
		return { runs, total, page, pageSize }
	}

	// Admin Match History's "View Log" button: resolves a page of matchIds to
	// their RLOG run ids in one query, exact (not a lobby-code-recency guess --
	// see getRunIdsForMatchIds's own doc comment).
	async function getRunIdsForMatchIds(matchIds: string[]): Promise<Map<string, string>> {
		return repository.getRunIdsForMatchIds(matchIds)
	}

	// Phase 7: best-effort one-time state snapshot for a spectator joining a
	// live match, derived from whatever the in-memory buffer has observed so
	// far for each player (their most recent ante marker and hand result).
	// Returns [] for a lobby with no buffered run yet (e.g. still in the menu).
	function getSpectatorSnapshot(lobbyCode: string): SpectatorSnapshotEntry[] {
		const run = runs.get(lobbyCode)
		if (!run) return []

		const snapshot: SpectatorSnapshotEntry[] = []
		for (const [playerId, buf] of run.players) {
			let ante: string | null = null
			let score: string | null = null
			let handsRemaining: number | null = null
			let lobbyInfo: { gamemode: string; ruleset: string; sleeve: string | null; challenge: string | null } | null =
				null
			let runInfo: { seed: string; deck: string; stake: number | null } | null = null

			for (const event of buf.events) {
				if (
					event.opcode === 'set_ante_key' &&
					Array.isArray(event.args) &&
					typeof event.args[0] === 'string'
				) {
					ante = event.args[0]
				} else if (
					event.opcode === 'hand_result' &&
					Array.isArray(event.args)
				) {
					const [s, h] = event.args
					if (typeof s === 'string') score = s
					if (typeof h === 'number') handsRemaining = h
				} else if (event.opcode === 'lobby_info' && !lobbyInfo && isLobbyInfoArgs(event.args)) {
					const options = (event.args as { options?: Record<string, unknown> }).options ?? {}
					lobbyInfo = {
						gamemode: event.args.gamemode,
						ruleset: event.args.ruleset,
						sleeve: typeof options.sleeve === 'string' ? options.sleeve : null,
						challenge: typeof options.challenge === 'string' ? options.challenge : null,
					}
				} else if (event.opcode === 'run_info' && isRunInfoArgs(event.args)) {
					// Last-seen, not first -- see SpectatorManifest's own comment.
					runInfo = {
						seed: event.args.seed,
						deck: event.args.deck,
						stake: typeof event.args.stake === 'number' ? event.args.stake : null,
					}
				}
			}

			const manifest: SpectatorManifest | null =
				lobbyInfo && runInfo
					? {
							seed: runInfo.seed,
							deck: runInfo.deck,
							stake: runInfo.stake,
							ruleset: lobbyInfo.ruleset,
							gamemode: lobbyInfo.gamemode,
							sleeve: lobbyInfo.sleeve,
							challenge: lobbyInfo.challenge,
						}
					: null

			snapshot.push({ playerId, ante, score, handsRemaining, manifest })
		}
		return snapshot
	}

	// Crash-relaunch rejoin detection: "does this player have a match still in
	// progress right now" -- scans the live in-memory buffer (the same one
	// handleActionLogEvent/getTail already use), not Postgres. A run only
	// gets a durable matchRunLogs row at finalize time (see finalizeRun
	// above), so an in-progress run's player list only exists here while the
	// server process that received its events is still running -- exactly
	// the scenario this is for (the CLIENT crashed and relaunched, not the
	// server). Surviving a server restart too would need a second signal
	// (e.g. matchmaking.service.ts's restorePlayerMatchSession, which reads
	// Postgres) -- not needed for the common case and not wired up here.
	// `events` is this player's OWN buffered stream (getTail(lobbyCode,
	// playerId, 0)), included inline rather than requiring a second request:
	// GET /:runId/replay (getReplay) can't serve this -- it reads DB-persisted
	// matchRunLogs rows, which don't exist yet for a run that's still active
	// (those are only written at finalize time, see finalizeRun) -- confirmed
	// live, it 403s ("Not a participant in this run") for a genuinely active
	// run's own participant. Rejoin only ever needs the rejoining player's OWN
	// events to fast-forward their own local state (opponent catch-up is a
	// separate, already-existing mechanism -- grace-period.service.ts's
	// pushReplayCatchUp, unrelated to this), so there's no need to also
	// resolve/merge every other player's stream here.
	function findActiveRunForPlayer(
		playerId: string,
	): { runId: string; lobbyCode: string; modId: string; events: LogEvent[] } | null {
		for (const [lobbyCode, run] of runs) {
			if (run.players.has(playerId)) {
				const lobby = getLobby(lobbyCode)
				// The run buffer's own player list (populated by
				// handleActionLogEvent) is NOT tied to live lobby membership --
				// an explicit Abandon (POST /api/lobbies/:code/leave) removes the
				// player from the LOBBY but doesn't touch this run's buffer at all
				// (only a full lobby close or grace-period expiry finalizes/clears
				// it, and the lobby here is still alive for its other player(s)).
				// Without this check, a player who explicitly abandoned would keep
				// getting the rejoin prompt on every subsequent relaunch until the
				// whole match ends for everyone else too -- confirmed live.
				if (!lobby || !lobby.hasPlayer(playerId)) continue
				return {
					runId: run.runId,
					lobbyCode,
					modId: lobby?.modId ?? '',
					// getTail's filter is `e.t > sinceT`, strictly exclusive --
					// correct for its original caller (opponent catch-up: "events
					// since I last saw them", where the boundary event was already
					// delivered) but sinceT=0 would silently drop the manifest
					// event itself, which is always recorded at t=0 (see
					// recorder.lua's begin_run) -- confirmed live, rejoin failed
					// with "no manifest event" until this was -1'd. -1 is safe
					// since every real event's t is >= 0.
					events: getTail(lobbyCode, playerId, -1),
				}
			}
		}
		return null
	}

	return {
		handleActionLogEvent,
		finalizeRun,
		hasBufferedRun,
		getReplay,
		listMyRuns,
		getRunIdsForMatchIds,
		getSpectatorSnapshot,
		verifyPlayerHash,
		countHandResultEvents,
		getTail,
		findActiveRunForPlayer,
	}
}

// Module-level singleton, matching mqttService/gracePeriodService -- the
// lobby lifecycle hooks (grace-period expiry, explicit leave) and
// matchmaking's reportResult all need to reach the same buffer without being
// threaded through DI at every call site.
export const replayLogService = createReplayLogService({
	repository: replayLogGateway,
})
