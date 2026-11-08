// Playing the matches: ready-up, the lobbies the games are played in, their
// results, and what organisers (and co-organisers) can do about a match.
// Pure, like lifecycle.ts: effects.ts makes the lobbies and sends the
// notifications these changes call for.
//
// A match's game goes: both players ready (tournament_ready) -> the
// timetable hands it to a lobby (MatchClock in_game) -> effects.ts claims
// and makes one PvP lobby for that game -> the lobby's stored run comes back
// through gameEnded -> the game is recorded (or the match waits for an
// organiser, or goes back to ready-up).
import { FAILED_PRECONDITION, INVALID_ARGUMENT, NOT_FOUND, PERMISSION_DENIED } from '../errors'
import type { RunRecord } from '../lobby/protocol'
import { err, ok } from '../shared/result'
import { clearMatch, decideMatch, recordGame } from './engine/bracket'
import { resolveBracket } from './engine/resolve'
import { MINUTE_MS, blockOfRound, extendMatch, pause, reopenReadyUp, resume, setReady, startBlock } from './engine/schedule'
import type { Decision, EngineError, EntrantId, GameOutcome, ResolvedMatch, Side } from './engine/types'
import { type Change, type LifecycleError, settleTimetable, touch, withEvent } from './lifecycle'
import { type RoundSettings, type Tournament, type TournamentLobby, type TournamentLobbyRef, isManager, roundSettingsFor } from './model'

function matchFail(code: number, message: string): { ok: false; error: LifecycleError } {
	return err({ code, message })
}

function engineFail(e: EngineError): { ok: false; error: LifecycleError } {
	const code = e.code === 'unknown_match' ? NOT_FOUND : e.code === 'invalid' ? INVALID_ARGUMENT : FAILED_PRECONDITION
	return matchFail(code, e.message)
}

function isRunning(t: Tournament): t is Tournament & Required<Pick<Tournament, 'bracket' | 'schedule' | 'clock'>> {
	return t.status === 'running' && !!t.bracket && !!t.schedule && !!t.clock
}

function pairOf(m: ResolvedMatch): [EntrantId, EntrantId] | null {
	const [a, b] = m.players
	return typeof a === 'string' && typeof b === 'string' ? [a, b] : null
}

// The caller's current match: the one with an open clock (ready-up or in a
// game) that they play in.
export function currentMatchOf(t: Tournament, userId: string): string | null {
	if (!isRunning(t)) return null
	const resolved = resolveBracket(t.bracket, t.dropped)
	for (const id of Object.keys(t.clock.matches)) {
		const c = t.clock.matches[id]
		if (c.phase !== 'ready_up' && c.phase !== 'in_game') continue
		const pair = pairOf(resolved.byId[id])
		if (pair && pair.indexOf(userId) !== -1) return id
	}
	return null
}

// {matchId?, ready} for the caller: their side's ready flag in that match's
// current ready-up.
export function readyUp(t: Tournament, userId: string, matchId: string | null, ready: boolean, now: number): Change {
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	if (t.clock.pausedSince !== undefined) return matchFail(FAILED_PRECONDITION, 'The tournament is paused')
	const id = matchId ?? currentMatchOf(t, userId)
	if (!id) return matchFail(FAILED_PRECONDITION, 'You have no match to ready up for')
	const m = resolveBracket(t.bracket, t.dropped).byId[id]
	const pair = m ? pairOf(m) : null
	if (!pair || pair.indexOf(userId) === -1) return matchFail(PERMISSION_DENIED, 'That is not your match')
	const clock = t.clock.matches[id]
	if (!clock || clock.phase !== 'ready_up') return matchFail(FAILED_PRECONDITION, 'That match is not waiting for ready-up')
	const side = pair.indexOf(userId) as Side
	const r = setReady(t.clock, id, side, ready, now)
	if (!r.ok) return engineFail(r.error)
	return ok(settleTimetable(touch({ ...t, clock: r.value }, now), now))
}

export interface LobbyNeed {
	matchId: string
	game: number
	handoff: number
	players: [EntrantId, EntrantId]
	settings: RoundSettings
	stage: string
	round: number
}

// The games the timetable has handed to a lobby that has none yet.
export function lobbiesNeeded(t: Tournament): LobbyNeed[] {
	if (!isRunning(t)) return []
	const resolved = resolveBracket(t.bracket, t.dropped)
	const out: LobbyNeed[] = []
	for (const id of Object.keys(t.clock.matches)) {
		const c = t.clock.matches[id]
		if (c.phase !== 'in_game' || c.handoff === undefined) continue
		const lobby = t.lobbies ? t.lobbies[id] : undefined
		if (lobby && lobby.handoff === c.handoff) continue
		const m = resolved.byId[id]
		const pair = m ? pairOf(m) : null
		if (!pair) continue
		out.push({
			matchId: id,
			game: m.def.games.length + 1,
			handoff: c.handoff,
			players: pair,
			settings: roundSettingsFor(t, m.def.stage, m.def.round),
			stage: m.def.stage,
			round: m.def.round,
		})
	}
	return out
}

// Claims the match's lobby before it is made, so two servers (the clock and
// an RPC) can never make two: the version-checked save decides.
export function claimLobby(t: Tournament, need: LobbyNeed, code: string, now: number): Change {
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	const c = t.clock.matches[need.matchId]
	if (!c || c.phase !== 'in_game' || c.handoff !== need.handoff) return matchFail(FAILED_PRECONDITION, 'The game is no longer waiting for a lobby')
	const existing = t.lobbies ? t.lobbies[need.matchId] : undefined
	if (existing && existing.handoff === need.handoff) return matchFail(FAILED_PRECONDITION, 'Already claimed')
	const lobby: TournamentLobby = { code, game: need.game, handoff: need.handoff, status: 'creating', createdAt: now }
	return ok(touch({ ...t, lobbies: { ...(t.lobbies ?? {}), [need.matchId]: lobby } }, now))
}

function setLobby(t: Tournament, matchId: string, patch: Partial<TournamentLobby>): Tournament {
	const lobbies = t.lobbies ?? {}
	if (!lobbies[matchId]) return t
	return { ...t, lobbies: { ...lobbies, [matchId]: { ...lobbies[matchId], ...patch } } }
}

function winsOf(t: Tournament, matchId: string): [number, number] {
	const m = t.bracket ? resolveBracket(t.bracket, t.dropped).byId[matchId] : undefined
	return m ? m.wins : [0, 0]
}

export function lobbyOpened(t: Tournament, matchId: string, handoff: number, now: number): Change {
	const lobby = t.lobbies ? t.lobbies[matchId] : undefined
	if (!lobby || lobby.handoff !== handoff) return matchFail(FAILED_PRECONDITION, 'Not this lobby')
	const next = withEvent(setLobby(t, matchId, { status: 'open' }), now, 'lobby_opened', { matchId, code: lobby.code, game: lobby.game, wins: winsOf(t, matchId) })
	return ok(touch(next, now))
}

// The match's lobby is still up (the players are in it between games): play
// the next game there instead of making a new one.
export function lobbyReused(t: Tournament, need: LobbyNeed, now: number): Change {
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	const c = t.clock.matches[need.matchId]
	const lobby = t.lobbies ? t.lobbies[need.matchId] : undefined
	if (!c || c.phase !== 'in_game' || c.handoff !== need.handoff) return matchFail(FAILED_PRECONDITION, 'The game is no longer waiting for a lobby')
	if (!lobby || lobby.status !== 'open' || lobby.handoff === need.handoff) return matchFail(FAILED_PRECONDITION, 'No lobby to reuse')
	const next = withEvent(setLobby(t, need.matchId, { handoff: need.handoff, game: need.game }), now, 'lobby_opened', {
		matchId: need.matchId,
		code: lobby.code,
		game: need.game,
		wins: winsOf(t, need.matchId),
		reused: true,
	})
	return ok(touch(next, now))
}

// The game's result from a stored run: a side, a draw, 'dispute' (the
// players' reports disagree, or one was contested) or 'none' (no result:
// abandoned, or nobody's placing is known). 'restarted' runs are skipped by
// the caller: the same lobby plays on.
export function outcomeFromRun(run: RunRecord, pair: [EntrantId, EntrantId]): GameOutcome | 'dispute' | 'none' {
	if (run.status === 'disputed' || run.status === 'contested') return 'dispute'
	if (run.status === 'abandoned' || run.status === 'restarted') return 'none'
	const place = (id: string) => {
		const p = run.placements.find((x) => x.playerId === id)
		return p ? p.place : null
	}
	const a = place(pair[0])
	const b = place(pair[1])
	if (a === null && b === null) return 'none'
	// Only one placed: the other left the game.
	if (a === null) return 1
	if (b === null) return 0
	if (a === b) return 'draw'
	return a < b ? 0 : 1
}

// The match's lobby stored a run. It counts when it comes from the match's
// current lobby while a game is handed to it; otherwise (an older lobby, a
// match decided meanwhile, a restart) null.
export function gameEnded(t: Tournament, ref: TournamentLobbyRef, run: RunRecord, now: number): Change | null {
	if (!isRunning(t) || run.status === 'restarted') return null
	const c = t.clock.matches[ref.matchId]
	const lobby = t.lobbies ? t.lobbies[ref.matchId] : undefined
	if (!lobby || lobby.code !== run.code || lobby.status !== 'open') return null
	if (!c || c.phase !== 'in_game' || c.handoff !== lobby.handoff) return null
	const m = resolveBracket(t.bracket, t.dropped).byId[ref.matchId]
	const pair = m ? pairOf(m) : null
	if (!pair) return null
	const outcome = outcomeFromRun(run, pair)
	const fields = { matchId: ref.matchId, game: lobby.game, runId: run.runId }
	if (outcome === 'dispute') {
		const next = withEvent(setLobby(t, ref.matchId, { status: 'disputed', runId: run.runId }), now, 'result_disputed', { ...fields, status: run.status })
		return ok(touch(next, now))
	}
	if (outcome === 'none') {
		const reopened = reopenReadyUp(t.clock, ref.matchId, now, seriesMinutesFor(t, ref.matchId))
		if (!reopened.ok) return engineFail(reopened.error)
		const next = withEvent(setLobby({ ...t, clock: reopened.value }, ref.matchId, { runId: run.runId }), now, 'game_abandoned', fields)
		return ok(settleTimetable(touch(next, now), now))
	}
	const recorded = recordGame(t.bracket, ref.matchId, outcome, t.dropped)
	if (!recorded.ok) return engineFail(recorded.error)
	const winner = outcome === 'draw' ? null : pair[outcome]
	const next = withEvent(setLobby({ ...t, bracket: recorded.value }, ref.matchId, { runId: run.runId }), now, 'game_recorded', { ...fields, winner, draw: outcome === 'draw' })
	return ok(settleTimetable(touch(next, now), now))
}

// The series ready-up time of the block the match's round is in.
function seriesMinutesFor(t: Tournament, matchId: string): number {
	const DEFAULT_MINUTES = 3
	if (!t.bracket || !t.schedule) return DEFAULT_MINUTES
	const m = t.bracket.matches.find((x) => x.id === matchId)
	const block = m ? blockOfRound(t.bracket, t.schedule, m.stage, m.round) : null
	return block ? block.seriesReadyUpMinutes : DEFAULT_MINUTES
}

// The lobby vanished while a game was handed to it, without storing a run
// (nobody started the game, or the server lost it): back to ready-up; the
// next hand-off makes a new lobby.
export function lobbyLost(t: Tournament, matchId: string, handoff: number, now: number): Change | null {
	if (!isRunning(t)) return null
	const c = t.clock.matches[matchId]
	const lobby = t.lobbies ? t.lobbies[matchId] : undefined
	if (!c || c.phase !== 'in_game' || c.handoff !== handoff || !lobby || lobby.handoff !== handoff) return null
	if (lobby.status !== 'open' && lobby.status !== 'creating') return null
	const reopened = reopenReadyUp(t.clock, matchId, now, seriesMinutesFor(t, matchId))
	if (!reopened.ok) return engineFail(reopened.error)
	const next = withEvent(setLobby({ ...t, clock: reopened.value }, matchId, { status: 'lost' }), now, 'lobby_lost', { matchId, game: lobby.game })
	return ok(settleTimetable(touch(next, now), now))
}

// The server closed the match's lobby (effects.ts) once the match was
// decided: the players are back in the tournament.
export function lobbyClosed(t: Tournament, matchId: string, code: string, now: number): Change | null {
	const lobby = t.lobbies ? t.lobbies[matchId] : undefined
	if (!lobby || lobby.code !== code || lobby.status === 'closed') return null
	return ok(touch(withEvent(setLobby(t, matchId, { status: 'closed' }), now, 'lobby_closed', { matchId, code }), now))
}

// --- Organisers and co-organisers

function requireManager(t: Tournament, userId: string): { ok: false; error: LifecycleError } | null {
	return isManager(t, userId) ? null : matchFail(PERMISSION_DENIED, 'Only the organisers can do that')
}

export interface ResultInput {
	matchId: string
	// 'game': add one game to the series (e.g. a disputed game the organiser
	// settled). 'match': set the whole match's result.
	scope: 'game' | 'match'
	winner?: EntrantId
	draw?: boolean
	// Match only: nobody advances (elimination) / both lose (RR/Swiss).
	none?: boolean
	resetDownstream?: boolean
}

export function setResult(t: Tournament, userId: string, input: ResultInput, now: number): Change {
	const refused = requireManager(t, userId)
	if (refused) return refused
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	const m = resolveBracket(t.bracket, t.dropped).byId[input.matchId]
	if (!m) return matchFail(NOT_FOUND, 'No such match')
	const pair = pairOf(m)
	if (!pair) return matchFail(FAILED_PRECONDITION, 'Both players of that match are not known yet')
	let side: Side | 'draw' | 'none'
	if (input.none) side = 'none'
	else if (input.draw) side = 'draw'
	else if (input.winner !== undefined && pair.indexOf(input.winner) !== -1) side = pair.indexOf(input.winner) as Side
	else return matchFail(INVALID_ARGUMENT, 'Give the winner (one of the two players), draw or none')

	let bracket = t.bracket
	if (input.scope === 'game') {
		if (side === 'none') return matchFail(INVALID_ARGUMENT, 'A game has a winner or is a draw')
		const r = recordGame(bracket, input.matchId, side, t.dropped)
		if (!r.ok) return engineFail(r.error)
		bracket = r.value
	} else {
		const decision: Decision = { kind: 'override', outcome: side }
		const r = decideMatch(bracket, input.matchId, decision, { dropped: t.dropped, resetDownstream: input.resetDownstream })
		if (!r.ok) {
			if (r.error.code === 'downstream_played') {
				return matchFail(FAILED_PRECONDITION, `Later matches already have results: ${r.error.matchIds.join(', ')}. Send resetDownstream to clear them.`)
			}
			return engineFail(r.error)
		}
		bracket = r.value
	}
		let next: Tournament = { ...t, bracket }
	const lobby = t.lobbies ? t.lobbies[input.matchId] : undefined
	// A disputed game settled: the lobby plays on (or closes, if this decided the match).
	if (lobby && lobby.status === 'disputed') next = setLobby(next, input.matchId, { status: 'open' })
	next = withEvent(next, now, 'result_set', { matchId: input.matchId, by: userId, scope: input.scope, winner: side === 'none' || side === 'draw' ? null : pair[side], draw: side === 'draw', none: side === 'none' })
	return ok(settleTimetable(touch(next, now), now))
}

export function clearResult(t: Tournament, userId: string, matchId: string, resetDownstream: boolean, now: number): Change {
	const refused = requireManager(t, userId)
	if (refused) return refused
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	const r = clearMatch(t.bracket, matchId, { dropped: t.dropped, resetDownstream })
	if (!r.ok) {
		if (r.error.code === 'downstream_played') {
			return matchFail(FAILED_PRECONDITION, `Later matches already have results: ${r.error.matchIds.join(', ')}. Send resetDownstream to clear them.`)
		}
		return engineFail(r.error)
	}
	const next = withEvent({ ...t, bracket: r.value }, now, 'result_cleared', { matchId, by: userId })
	return ok(settleTimetable(touch(next, now), now))
}

export function extend(t: Tournament, userId: string, matchId: string, minutes: number, now: number): Change {
	const refused = requireManager(t, userId)
	if (refused) return refused
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) return matchFail(INVALID_ARGUMENT, 'minutes must be 1 to 10080')
	const r = extendMatch(t.clock, matchId, minutes, now)
	if (!r.ok) return engineFail(r.error)
	const next = withEvent({ ...t, clock: r.value }, now, 'deadline_extended', { matchId, minutes, by: userId })
	return ok(settleTimetable(touch(next, now), now))
}

export function setPaused(t: Tournament, userId: string, paused: boolean, now: number): Change {
	const refused = requireManager(t, userId)
	if (refused) return refused
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	const r = paused ? pause(t.clock, now) : resume(t.clock, now)
	if (!r.ok) return engineFail(r.error)
	const next = withEvent({ ...t, clock: r.value }, now, paused ? 'paused' : 'resumed', { by: userId })
	return ok(settleTimetable(touch(next, now), now))
}

// Starts the next round block now (a manual one, or one waiting for its
// time or its break).
export function startNextRound(t: Tournament, userId: string, now: number): Change {
	const refused = requireManager(t, userId)
	if (refused) return refused
	if (!isRunning(t)) return matchFail(FAILED_PRECONDITION, 'The tournament is not running')
	const block = t.clock.blocks.findIndex((b) => b.startedAt === undefined)
	if (block === -1) return matchFail(FAILED_PRECONDITION, 'Every round has started')
	const r = startBlock(t.clock, block, now)
	if (!r.ok) return engineFail(r.error)
	const next = withEvent({ ...t, clock: r.value }, now, 'round_started_early', { block, by: userId })
	return ok(settleTimetable(touch(next, now), now))
}

// Minutes left before a ready-up deadline, for notifications.
export function minutesLeft(deadline: number | null, now: number): number | null {
	return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / MINUTE_MS))
}
