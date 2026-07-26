import { createHash } from 'node:crypto'
import type {
	FlagReason,
	IReplayLogRepository,
	LobbyRunStatus,
	RunRow,
	RunWithLogs,
} from '../../contracts/IReplayLogRepository.js'
import * as replayLogGateway from '../../infrastructure/gateways/replay-log.gateway.js'
import { compressToBase64 } from '../../shared/utils/compression.js'
import { AppError } from '../../shared/utils/errors.js'
import { getLobby } from '../../state/index.js'

// Indefinite (NULL expiresAt) is reserved for flagged/disputed runs -- see
// finalizeRun's flags param, set by matchmaking.service.ts's evaluateAntiCheat.
const RUN_TTL_MS = 180 * 24 * 60 * 60 * 1000

// Framing opcodes (see BalatroMultiplayerPvP's lib/replay_log.lua) are excluded
// from the anti-cheat hash input on both sides -- they're emitted directly via
// emit_carbon, bypassing RLOG.record, so the client's own hash (computed over
// RLOG._structured_events) never includes them either.
const FRAMING_OPCODES = new Set(['manifest', 'end', 'chk'])

// Mirrors lib/replay_log.lua's canonical_hash_input/encode_event_tuple:
// gameplay events only, encoded as [t, opcode, args] positional tuples (array
// order is unambiguous in JSON, sidestepping any Lua/JS key-order mismatch a
// dict-shaped encoding would risk) -- so this must stay byte-for-byte aligned
// with the Lua side's encoding rules, not just "produce valid JSON".
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

// The manifest event's args is the full PVP.RLOG.begin_run table (see
// networking/action_handlers.lua's action_start_game) -- only the fields a
// seeded local run bootstrap (PVP._start_playback) actually needs are
// validated here.
function isManifestArgs(args: unknown): args is {
	seed: string
	deck: string
	sleeve?: string
	challenge?: string
	ruleset: string
	gamemode: string
	stake?: number
} {
	if (!args || typeof args !== 'object') return false
	const a = args as Record<string, unknown>
	return (
		typeof a.seed === 'string' &&
		typeof a.deck === 'string' &&
		typeof a.ruleset === 'string' &&
		typeof a.gamemode === 'string'
	)
}

interface PlayerBuffer {
	events: LogEvent[]
	carbonHash: string | null
}

interface RunBuffer {
	runId: string
	players: Map<string, PlayerBuffer>
}

// §22.3 full-fidelity spectate: the manifest fields a client needs to
// bootstrap a seeded local run (PVP._start_playback) that reproduces this
// player's exact cards -- same shape PVP.RLOG.begin_run records client-side
// (lib/replay_log.lua's REQUIRED_MANIFEST_KEYS), a subset of the full
// manifest event's own payload.
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

					const runId = await repository.insertRun({
						lobbyCode,
						modId: lobby.modId,
						lobbyType: lobby.type,
						matchmakingMatchId: null,
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
				compressedEvents: compressToBase64(JSON.stringify(buf.events)),
				carbonHash: buf.carbonHash,
				eventCount: buf.events.length,
				status: playerStatus,
				flagReason,
				expiresAt,
			})
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
	async function listMyRuns(playerId: string, limit = 20): Promise<RunRow[]> {
		return repository.getRunsForPlayer(playerId, limit)
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
			let manifest: SpectatorManifest | null = null

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
				} else if (event.opcode === 'manifest' && isManifestArgs(event.args)) {
					manifest = {
						seed: event.args.seed,
						deck: event.args.deck,
						sleeve: event.args.sleeve ?? null,
						challenge: event.args.challenge ?? null,
						ruleset: event.args.ruleset,
						gamemode: event.args.gamemode,
						stake: typeof event.args.stake === 'number' ? event.args.stake : null,
					}
				}
			}

			snapshot.push({ playerId, ante, score, handsRemaining, manifest })
		}
		return snapshot
	}

	return {
		handleActionLogEvent,
		finalizeRun,
		hasBufferedRun,
		getReplay,
		listMyRuns,
		getSpectatorSnapshot,
		verifyPlayerHash,
		countHandResultEvents,
		getTail,
	}
}

// Module-level singleton, matching mqttService/gracePeriodService -- the
// lobby lifecycle hooks (grace-period expiry, explicit leave) and
// matchmaking's reportResult all need to reach the same buffer without being
// threaded through DI at every call site.
export const replayLogService = createReplayLogService({
	repository: replayLogGateway,
})
