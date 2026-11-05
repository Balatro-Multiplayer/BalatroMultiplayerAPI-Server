// What a saved tournament change sets off in the world: notifications for
// its new events, the PvP lobbies its games need, and noticing lobbies that
// closed without a result. Every save goes through commit(), so nothing is
// missed whether the change came from an RPC, the clock or a lobby.
import { bindCode, lookupCode, releaseCode, reserveCode } from '../lobby/codes'
import { LOBBY_MATCH, type RunRecord } from '../lobby/protocol'
import { CODE_ATTEMPTS, MATCHMADE_CODE_LENGTH, generateCode } from '../lobby/rpc'
import { NotifyCode, notify } from '../notify'
import { readConfig } from '../config'
import { integrityRefusal, readIntegrity } from '../integrity'
import { requiredStandingFor } from '../standing/standing'
import { resolveBracket } from './engine/resolve'
import type { Change } from './lifecycle'
import { type LobbyNeed, claimLobby, gameEnded, lobbiesNeeded, lobbyClosed, lobbyLost, lobbyOpened, lobbyReused, minutesLeft } from './matches'
import { lobbiesToClose } from './lobby_state'
import { draftOrderFor } from './lobby_draft'
import {
	TOURNAMENT_MOD_ID,
	type Tournament,
	type TournamentLobbyRef,
	isFakeEntrant,
	nowFor,
} from './model'
import { mutate } from './storage'

// How long a lobby may be gone before its game goes back to ready-up (a
// lobby being made, or one restarting after a server restart, is briefly
// not findable by its code).
const LOBBY_LOST_AFTER_MS = 60 * 1000

// Saves a change (load -> change -> version-checked save, retried) and then
// acts on it. A change returning null saves nothing. Returns the tournament
// as it is after its effects (e.g. with the lobby it just made).
export function commit(nk: nkruntime.Nakama, logger: nkruntime.Logger, id: string, change: (t: Tournament) => Change | null): Tournament {
	const seen: { before: Tournament | null } = { before: null }
	const after = mutate(nk, id, (t) => {
		seen.before = t
		return change(t)
	})
	if (seen.before && after !== seen.before) return afterSave(nk, logger, seen.before, after)
	return after
}

function afterSave(nk: nkruntime.Nakama, logger: nkruntime.Logger, before: Tournament, after: Tournament): Tournament {
	let latest = after
	try {
		sendNotifications(nk, before, after)
	} catch (e) {
		logger.warn('Tournament %s: could not send notifications: %s', after.id, String(e))
	}
	for (const need of lobbiesNeeded(after)) {
		try {
			// The match's lobby is still up (players in it between games): play on there.
			const current = after.lobbies ? after.lobbies[need.matchId] : undefined
			if (current && current.status === 'open' && lookupCode(nk, current.code)) {
				latest = commit(nk, logger, after.id, (cur) => {
					const r = lobbyReused(cur, need, nowFor(cur, Date.now()))
					return r.ok ? r : null
				})
				continue
			}
			latest = createLobby(nk, logger, after, need) ?? latest
		} catch (e) {
			logger.error('Tournament %s: could not make a lobby for %s: %s', after.id, need.matchId, String(e))
		}
	}
	return latest
}

// --- Lobbies

function lobbyMetadata(t: Tournament, need: LobbyNeed): { [key: string]: unknown } {
	const m = t.bracket ? resolveBracket(t.bracket, t.dropped).byId[need.matchId] : undefined
	const names: { [id: string]: string } = {}
	for (const e of t.entrants) names[e.userId] = e.name
	return {
		// PvP reads the round's settings from here (Phase 8 wires the client).
		tournament: {
			id: t.id,
			name: t.name,
			matchId: need.matchId,
			stage: need.stage,
			round: need.round,
			game: need.game,
			bestOf: need.settings.bestOf,
			wins: m ? m.wins : [0, 0],
			players: need.players.map((id) => ({ id, name: names[id] ?? '?', seed: t.bracket ? t.bracket.seeds.indexOf(id) + 1 : null })),
			gameMode: need.settings.gameMode,
			ruleset: need.settings.ruleset,
			deck: need.settings.deck ?? null,
			lobbyOptions: need.settings.lobbyOptions ?? {},
		},
	}
}

// Claims, then makes, the PvP lobby for one game: only the two players may
// sit; the higher seed hosts. Whoever loses the claim (another server got
// there first) gives its code back. Returns the tournament afterwards, or
// null if another server made the lobby.
function createLobby(nk: nkruntime.Nakama, logger: nkruntime.Logger, t: Tournament, need: LobbyNeed): Tournament | null {
	for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
		const code = generateCode(MATCHMADE_CODE_LENGTH)
		if (!reserveCode(nk, code, TOURNAMENT_MOD_ID)) continue
		const real = Date.now()
		let claimed: Tournament
		try {
			claimed = commit(nk, logger, t.id, (cur) => claimLobby(cur, need, code, nowFor(cur, real)))
		} catch (e) {
			releaseCode(nk, code, '')
			return null
		}
		const draft = draftOrderFor(need.settings, claimed.bracket ? claimed.bracket.seeds : [], need.players)
		const ref: TournamentLobbyRef = draft ? { tournamentId: t.id, matchId: need.matchId, draft } : { tournamentId: t.id, matchId: need.matchId }
		let matchId: string
		try {
			matchId = nk.matchCreate(LOBBY_MATCH, {
				code,
				modId: TOURNAMENT_MOD_ID,
				maxPlayers: 2,
				creatorId: need.players[0],
				rankedMode: '',
				allowedIds: need.players.join(','),
				gameMode: '',
				// A ranked-profile tournament's games hold players to it too.
				requiredStanding: requiredStandingFor(claimed.requireRanked === true, readConfig(nk).integrityEnforced),
				tournament: JSON.stringify(ref),
				metadata: JSON.stringify(lobbyMetadata(claimed, need)),
			})
		} catch (e) {
			releaseCode(nk, code, '')
			logger.error('Tournament %s: lobby for %s failed to start: %s', t.id, need.matchId, String(e))
			return commit(nk, logger, t.id, (cur) => lobbyLost(cur, need.matchId, need.handoff, nowFor(cur, Date.now())))
		}
		bindCode(nk, code, matchId, TOURNAMENT_MOD_ID)
		logger.info('Tournament %s: lobby %s for %s game %d', t.id, code, need.matchId, need.game)
		return commit(nk, logger, t.id, (cur) => {
			const r = lobbyOpened(cur, need.matchId, need.handoff, nowFor(cur, Date.now()))
			return r.ok ? r : null
		})
	}
	throw new Error('Could not allocate a lobby code')
}

// A lobby's game ended (lobby/match.ts, after storing the run).
export function tournamentGameEnded(nk: nkruntime.Nakama, logger: nkruntime.Logger, ref: TournamentLobbyRef, run: RunRecord) {
	commit(nk, logger, ref.tournamentId, (t) => gameEnded(t, ref, run, nowFor(t, Date.now())))
}

// Lobbies that are gone without a result send their game back to ready-up.
// Returns the tournament as it is afterwards.
export function checkLobbies(nk: nkruntime.Nakama, logger: nkruntime.Logger, t: Tournament, real: number): Tournament {
	let latest = closeFinishedLobbies(nk, logger, t, real)
	if (latest.status !== 'running' || !latest.lobbies || !latest.clock) return latest
	t = latest
	const now = nowFor(t, real)
	if (!t.lobbies || !t.clock) return t
	for (const matchId of Object.keys(t.lobbies)) {
		const lobby = t.lobbies[matchId]
		const c = t.clock.matches[matchId]
		if (lobby.status !== 'open' && lobby.status !== 'creating') continue
		if (!c || c.phase !== 'in_game' || c.handoff !== lobby.handoff) continue
		if (now - lobby.createdAt < LOBBY_LOST_AFTER_MS) continue
		if (lookupCode(nk, lobby.code)) continue
		latest = commit(nk, logger, t.id, (cur) => lobbyLost(cur, matchId, lobby.handoff, nowFor(cur, real)))
	}
	return latest
}

// Closes the lobbies of decided matches (and of a tournament that is over),
// which sends the players back to the tournament. Never called from inside
// a lobby's own handler (a lobby can't be signalled from its own loop): the
// tournament clock and the RPCs call it, and wakeAt makes the clock come
// round within seconds.
function closeFinishedLobbies(nk: nkruntime.Nakama, logger: nkruntime.Logger, t: Tournament, real: number): Tournament {
	let latest = t
	for (const { matchId, code } of lobbiesToClose(t)) {
		try {
			const live = lookupCode(nk, code)
			if (live) nk.matchSignal(live.matchId, JSON.stringify({ type: 'admin_close' }))
		} catch (e) {
			logger.warn('Tournament %s: could not close lobby %s: %s', t.id, code, String(e))
		}
		latest = commit(nk, logger, t.id, (cur) => lobbyClosed(cur, matchId, code, nowFor(cur, real)))
	}
	return latest
}

// --- Notifications

function realPlayers(ids: (string | null | undefined)[]): string[] {
	const out: string[] = []
	for (const id of ids) if (typeof id === 'string' && !isFakeEntrant(id) && out.indexOf(id) === -1) out.push(id)
	return out
}

const MATCH_UPDATES = [
	'game_forfeited',
	'match_forfeited',
	'fallback_applied',
	'game_recorded',
	'game_abandoned',
	'lobby_lost',
	'result_set',
	'result_cleared',
	'deadline_extended',
	'match_reset',
	'lobby_closed',
]
const EVERYONE_UPDATES = ['check_in_opened', 'started', 'tournament_finished', 'cancelled', 'paused', 'resumed', 'round_started_early', 'settings_changed']
const MANAGER_UPDATES = ['unplayed', 'result_disputed']

function sendNotifications(nk: nkruntime.Nakama, before: Tournament, after: Tournament) {
	const fresh = after.events.filter((e) => (e.seq ?? 0) > (before.eventSeq ?? 0))
	if (fresh.length === 0) return
	const names: { [id: string]: string } = {}
	for (const e of after.entrants.concat(after.waitlist)) names[e.userId] = e.name
	const resolved = after.bracket ? resolveBracket(after.bracket, after.dropped) : null
	const matchPlayers = (matchId: unknown): string[] => {
		if (!resolved || typeof matchId !== 'string' || !resolved.byId[matchId]) return []
		return realPlayers(resolved.byId[matchId].players)
	}
	const everyone = realPlayers(after.entrants.map((e) => e.userId).concat(after.waitlist.map((e) => e.userId)))
	const managers = realPlayers([after.organiserId].concat(after.coOrganiserIds))
	const base = { tournamentId: after.id, name: after.name }
	const now = fresh[fresh.length - 1].at

	for (const e of fresh) {
		const matchId = typeof e.matchId === 'string' ? e.matchId : undefined
		const players = matchPlayers(matchId)
		if (e.kind === 'match_opened' || e.kind === 'series_ready_up' || e.kind === 'reminder') {
			const clock = after.clock && matchId ? after.clock.matches[matchId] : undefined
			const deadline = clock ? clock.deadline : null
			const pair = resolved && matchId ? resolved.byId[matchId].players : []
			for (const userId of players) {
				const opponentId = pair[0] === userId ? pair[1] : pair[0]
				notify(nk, userId, NotifyCode.TOURNAMENT_MATCH, `${after.name}: ready up`, {
					...base,
					matchId,
					kind: e.kind === 'match_opened' ? 'open' : e.kind === 'series_ready_up' ? 'series' : 'reminder',
					deadline,
					minutesLeft: minutesLeft(deadline, now),
					opponent: typeof opponentId === 'string' ? { id: opponentId, name: names[opponentId] ?? '?' } : null,
				})
			}
		} else if (e.kind === 'lobby_opened') {
			for (const userId of players) {
				notify(nk, userId, NotifyCode.TOURNAMENT_LOBBY, `${after.name}: your game is ready`, { ...base, matchId, code: e.code, game: e.game, wins: e.wins, reused: e.reused === true })
			}
		} else {
			let to: string[] = []
			if (MATCH_UPDATES.indexOf(e.kind) !== -1) to = players
			else if (EVERYONE_UPDATES.indexOf(e.kind) !== -1) to = everyone.concat(managers)
			else if (MANAGER_UPDATES.indexOf(e.kind) !== -1) to = managers.concat(players)
			else if (e.kind === 'promoted' && typeof e.userId === 'string') to = realPlayers([e.userId])
			for (const userId of to.filter((id, i) => to.indexOf(id) === i)) {
				notify(nk, userId, NotifyCode.TOURNAMENT_UPDATED, after.name, { ...base, kind: e.kind, matchId: matchId ?? null } as { [key: string]: unknown })
			}
		}
		// Check-in opened on a ranked-profile tournament: tell anyone not on
		// their ranked profile now, while there is time to switch.
		if (e.kind === 'check_in_opened' && after.requireRanked === true) {
			const config = readConfig(nk)
			for (const userId of realPlayers(after.entrants.map((x) => x.userId))) {
				if (!integrityRefusal(config, readIntegrity(nk, userId), now)) continue
				notify(nk, userId, NotifyCode.TOURNAMENT_UPDATED, `${after.name}: switch to your ranked profile to check in`, { ...base, kind: 'ranked_profile_needed', matchId: null })
			}
		}
	}
}

