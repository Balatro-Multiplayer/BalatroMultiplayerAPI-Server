// The tournament RPCs. Thin: check who is calling and that tournaments are
// switched on, then load -> lifecycle.ts change -> save (storage.ts). Every
// response carries serverNow so clients can show countdowns in local time.
// Each call also catches the tournament up first (advance), so state is never
// staler than the request even if the clock missed a tick.
import { readConfig } from '../config'
import { FAILED_PRECONDITION, INVALID_ARGUMENT, NOT_FOUND, PERMISSION_DENIED, runtimeError } from '../errors'
import { banMessage, playRefusal } from '../moderation/access'
import { activeBan, readBans } from '../moderation/bans'
import { displayNameOf, profileFor } from '../player/profile'
import { loadRatings } from '../rating/apply'
import { currentSeason } from '../rating/season'
import { parsePayload, requireServer, requireUser } from '../rpc'
import { settingsOf } from '../server_kind'
import { standingFor } from '../standing/current'
import { standingRefusal, queueRefusalMessage } from '../matchmaking/queue_refusal'
import { seededRng } from './engine/seeding'
import { ensureClock } from './clock'
import {
	type Change,
	type RatingsLookup,
	advance,
	cancel,
	checkInEntrant,
	closeByModerator,
	createTournament,
	joinTournament,
	leaveTournament,
	openRegistration,
	promote,
	removePlayer,
	setCoOrganisers,
	setManualSeeding,
	setRegistrationClosed,
	settleTimetable,
	start,
	updateSettings,
} from './lifecycle'
import { OFFICIAL_PRIVILEGE, TOURNAMENT_MOD_ID, type Input, type Tournament, isFakeEntrant, isManager, nowFor, roleOf } from './model'
export { nowFor }
import {
	type IndexEntry,
	insertTournament,
	mutate,
	readIndexEntries,
	readMineIds,
	readTournament,
	reserveInviteCode,
	scanIndex,
	spendTournamentCreate,
	tournamentIdForCode,
} from './storage'
import { tournamentView } from './view'
import { checkLobbies, commit } from './effects'
import { type ResultInput, clearResult, extend, readyUp, setPaused, setResult, startNextRound } from './matches'

export const TOURNAMENT_ID_PATTERN = /^[0-9a-f-]{36}$/
const LIST_LIMIT = 100

export function tournamentsEnabled(nk: nkruntime.Nakama): boolean {
	return readConfig(nk).tournamentsEnabled
}

function requireEnabled(nk: nkruntime.Nakama) {
	if (!tournamentsEnabled(nk)) throw runtimeError(FAILED_PRECONDITION, 'Tournaments are not enabled on this server')
}

export function ratingsLookup(nk: nkruntime.Nakama, now: number): RatingsLookup {
	return (userIds, board) => {
		const out: { [id: string]: number | undefined } = {}
		const real = userIds.filter((id) => !isFakeEntrant(id))
		if (real.length > 0) {
			const { current } = loadRatings(nk, TOURNAMENT_MOD_ID, board, real, now, currentSeason(nk))
			for (const id of Object.keys(current)) out[id] = current[id].rating
		}
		return out
	}
}

function inputString(input: Input, key: string, pattern?: RegExp): string {
	const v = input[key]
	if (typeof v !== 'string' || (pattern && !pattern.test(v))) throw runtimeError(INVALID_ARGUMENT, `${key} is required`)
	return v
}

export function tournamentIdOf(input: Input): string {
	return inputString(input, 'id', TOURNAMENT_ID_PATTERN)
}

// Who may play in a tournament: no matchmaking ban, not locked out by
// testing mode, and an account standing (reported mods) that may queue.
export function entryRefusal(nk: nkruntime.Nakama, ctx: nkruntime.Context, userId: string, now: number): string | null {
	const config = readConfig(nk)
	const ban = activeBan(readBans(nk, userId), 'queue', now)
	if (ban) return banMessage('You are banned from matchmaking', ban)
	const play = playRefusal(config, profileFor(nk, userId).privileges)
	if (play) return play
	const standing = standingRefusal(standingFor(nk, settingsOf(ctx), userId, now, config))
	return standing ? queueRefusalMessage(standing) : null
}

// Brings a tournament up to now (check-in opening, the start, the timetable)
// and saves it if anything changed.
export function catchUpTournament(nk: nkruntime.Nakama, logger: nkruntime.Logger, id: string, real: number): Tournament {
	const t = commit(nk, logger, id, (cur) => {
		const now = nowFor(cur, real)
		const next = advance(cur, now, ratingsLookup(nk, now), seededRng(real))
		return next ? { ok: true, value: next } : null
	})
	return checkLobbies(nk, logger, t, real)
}

function respond(t: Tournament, viewerId: string, real: number): string {
	return JSON.stringify({ tournament: tournamentView(t, viewerId, nowFor(t, real)) })
}

// Applies a lifecycle change at the tournament's own now, settles the
// timetable, saves, and answers with the new view.
function changeTournament(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	ctx: nkruntime.Context,
	payload: string,
	apply: (t: Tournament, userId: string, now: number, input: Input) => Change,
): string {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const id = tournamentIdOf(input)
	const real = Date.now()
	ensureClock(nk)
	catchUpTournament(nk, logger, id, real)
	const saved = commit(nk, logger, id, (t) => {
		const now = nowFor(t, real)
		const r = apply(t, userId, now, input)
		return r.ok ? { ok: true, value: settleTimetable(r.value, now) } : r
	})
	return respond(saved, userId, real)
}

// Making (or keeping) a tournament official needs the official privilege.
function requireOfficialRight(nk: nkruntime.Nakama, userId: string, input: Input) {
	if (input.official !== true) return
	if (profileFor(nk, userId).privileges.indexOf(OFFICIAL_PRIVILEGE) === -1) {
		throw runtimeError(PERMISSION_DENIED, 'Only players with official rights can run official tournaments')
	}
}

function displayNameFor(nk: nkruntime.Nakama, ctx: nkruntime.Context, userId: string): string {
	return displayNameOf(profileFor(nk, userId, ctx.username))
}

// --- Players

// {status?: 'upcoming' | 'running' | 'finished'} -> public tournaments.
export function rpcTournamentList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	requireUser(ctx)
	const input = parsePayload(payload)
	const want = input.status ?? 'upcoming'
	const statuses: { [k: string]: string[] } = {
		upcoming: ['registration', 'check_in'],
		running: ['running'],
		finished: ['finished'],
	}
	const keep = statuses[want as string]
	if (!keep) throw runtimeError(INVALID_ARGUMENT, 'status must be upcoming, running or finished')
	ensureClock(nk)
	const entries = scanIndex(nk, (e) => e.visibility === 'public' && keep.indexOf(e.status) !== -1, LIST_LIMIT)
	// Official tournaments first, then by start (newest finish first for finished ones).
	entries.sort((a, b) => {
		if (!!a.official !== !!b.official) return a.official ? -1 : 1
		return want === 'finished' ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : a.startsAt - b.startsAt
	})
	return JSON.stringify({ serverNow: Date.now(), tournaments: entries.map(publicSummary) })
}

function publicSummary(e: IndexEntry) {
	const { organiserId, updatedAt, finishedAt, ...summary } = e
	return summary
}

// {id} -> the full view. Private tournaments are visible to their members
// and to anyone who has the invite code ({code}).
export function rpcTournamentGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	let id = typeof input.id === 'string' ? input.id : null
	if (!id && typeof input.code === 'string') id = tournamentIdForCode(nk, input.code)
	if (!id || !TOURNAMENT_ID_PATTERN.test(id)) throw runtimeError(NOT_FOUND, 'No such tournament')
	const real = Date.now()
	ensureClock(nk)
	if (!readTournament(nk, id)) throw runtimeError(NOT_FOUND, 'No such tournament')
	const t = catchUpTournament(nk, logger, id, real)
	const member = readMineIds(nk, userId).indexOf(id) !== -1 || isManager(t, userId)
	const viaCode = typeof input.code === 'string' && input.code.toUpperCase() === t.inviteCode
	if (t.visibility === 'private' && !member && !viaCode) throw runtimeError(NOT_FOUND, 'No such tournament')
	if (t.status === 'draft' && !isManager(t, userId)) throw runtimeError(NOT_FOUND, 'No such tournament')
	return respond(t, userId, real)
}

// {} -> summaries of every tournament the caller organises, helps run,
// plays in or waits for, each with the caller's role in it ('organiser',
// 'co_organiser', 'entrant', 'waitlist'; 'none' once removed).
export function rpcTournamentMine(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const real = Date.now()
	ensureClock(nk)
	const ids = readMineIds(nk, userId)
	const entries = readIndexEntries(nk, ids)
	// Catch up the ones still going, so countdowns and statuses are current.
	const out = entries.map((e) => {
		const over = e.status === 'finished' || e.status === 'cancelled' || e.status === 'draft'
		const t = over ? (readTournament(nk, e.id) || { t: null }).t : catchUpTournament(nk, logger, e.id, real)
		if (!t) return { ...publicSummary(e), organiser: e.organiserId === userId, role: 'none' }
		return {
			...publicSummary({ ...e, status: t.status, players: t.entrants.length, startsAt: t.startsAt }),
			organiser: e.organiserId === userId,
			role: roleOf(t, userId),
		}
	})
	return JSON.stringify({ serverNow: real, tournaments: out })
}

// {id} or {code} -> joins (or joins the waitlist when full).
export function rpcTournamentJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	let id = typeof input.id === 'string' ? input.id : null
	const viaCode = typeof input.code === 'string'
	if (viaCode) id = tournamentIdForCode(nk, input.code as string)
	if (!id || !TOURNAMENT_ID_PATTERN.test(id)) throw runtimeError(NOT_FOUND, 'No such tournament')
	const real = Date.now()
	const refused = entryRefusal(nk, ctx, userId, real)
	if (refused) throw runtimeError(PERMISSION_DENIED, refused)
	const name = displayNameFor(nk, ctx, userId)
	ensureClock(nk)
	catchUpTournament(nk, logger, id, real)
	const saved = commit(nk, logger, id, (t) => {
		if (t.visibility === 'private' && !viaCode) return { ok: false, error: { code: NOT_FOUND, message: 'No such tournament' } }
		return joinTournament(t, { id: userId, name }, nowFor(t, real))
	})
	return respond(saved, userId, real)
}

export function rpcTournamentLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => leaveTournament(t, userId, now))
}

export function rpcTournamentCheckIn(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => checkInEntrant(t, userId, now))
}

// --- Organisers

// {settings...} -> a new draft tournament owned by the caller.
export function rpcTournamentCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const real = Date.now()
	const refused = entryRefusal(nk, ctx, userId, real)
	if (refused) throw runtimeError(PERMISSION_DENIED, refused)
	ensureClock(nk)
	requireOfficialRight(nk, userId, input)
	spendTournamentCreate(nk, userId, real)
	const id = nk.uuidv4()
	const code = reserveInviteCode(nk, id)
	const created = createTournament(id, { id: userId, name: displayNameFor(nk, ctx, userId) }, input, code, real)
	if (!created.ok) throw runtimeError(created.error.code, created.error.message)
	insertTournament(nk, created.value)
	logger.info('Tournament %s created by %s', id, userId)
	return respond(created.value, userId, real)
}

// {id, ...settings to change}
export function rpcTournamentUpdate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => {
		const { id, ...settings } = input
		requireOfficialRight(nk, userId, settings)
		return updateSettings(t, userId, settings, now)
	})
}

export function rpcTournamentOpen(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => openRegistration(t, userId, now))
}

// {id, closed: boolean}
export function rpcTournamentRegistrationSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => {
		if (typeof input.closed !== 'boolean') return { ok: false, error: { code: INVALID_ARGUMENT, message: 'closed must be true or false' } }
		return setRegistrationClosed(t, userId, input.closed, now)
	})
}

// {id, userId}
export function rpcTournamentPromote(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => promote(t, userId, inputString(input, 'userId'), now))
}

// {id, userId}
export function rpcTournamentRemovePlayer(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => removePlayer(t, userId, inputString(input, 'userId'), now))
}

// {id, userIds: string[]}
export function rpcTournamentCoOrganisersSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => {
		const ids = input.userIds
		if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && TOURNAMENT_ID_PATTERN.test(i))) {
			return { ok: false, error: { code: INVALID_ARGUMENT, message: 'userIds must be player ids' } }
		}
		return setCoOrganisers(t, userId, ids as string[], now)
	})
}

// {id, order: string[]} -> manual seeding.
export function rpcTournamentSeedingSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => {
		const order = input.order
		if (!Array.isArray(order) || !order.every((i) => typeof i === 'string')) {
			return { ok: false, error: { code: INVALID_ARGUMENT, message: 'order must be a list of entrant ids' } }
		}
		return setManualSeeding(t, userId, order as string[], now)
	})
}

// {id} -> starts now (before the scheduled time).
export function rpcTournamentStart(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => {
		if (t.organiserId !== userId) return { ok: false, error: { code: PERMISSION_DENIED, message: 'Only the organiser can do that' } }
		return start(t, now, ratingsLookup(nk, now), seededRng(Date.now()))
	})
}

export function rpcTournamentCancel(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => cancel(t, userId, now))
}

// --- Playing the matches

// {id, matchId?, ready?: boolean (default true)} -> the caller's ready flag
// for their current (or the given) match.
export function rpcTournamentReady(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => {
		const matchId = typeof input.matchId === 'string' ? input.matchId : null
		return readyUp(t, userId, matchId, input.ready !== false, now)
	})
}

// {id, matchId, scope: 'game' | 'match', winner?: userId, draw?, none?,
// resetDownstream?} -- organisers and co-organisers.
export function rpcTournamentResultSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) => {
		const scope = input.scope
		if (scope !== 'game' && scope !== 'match') return { ok: false, error: { code: INVALID_ARGUMENT, message: 'scope must be game or match' } }
		const result: ResultInput = {
			matchId: inputString(input, 'matchId'),
			scope,
			winner: typeof input.winner === 'string' ? input.winner : undefined,
			draw: input.draw === true,
			none: input.none === true,
			resetDownstream: input.resetDownstream === true,
		}
		return setResult(t, userId, result, now)
	})
}

// {id, matchId, resetDownstream?}
export function rpcTournamentResultClear(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) =>
		clearResult(t, userId, inputString(input, 'matchId'), input.resetDownstream === true, now),
	)
}

// {id, matchId, minutes}
export function rpcTournamentExtend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) =>
		extend(t, userId, inputString(input, 'matchId'), typeof input.minutes === 'number' ? input.minutes : Number.NaN, now),
	)
}

export function rpcTournamentPause(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => setPaused(t, userId, true, now))
}

export function rpcTournamentResume(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => setPaused(t, userId, false, now))
}

// {id} -> starts the next round block now.
export function rpcTournamentRoundStart(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => startNextRound(t, userId, now))
}

// --- Moderators (server to server, from the web admin)

// {id, reason} -> closes the tournament. Works with tournaments switched off.
export function rpcAdminTournamentClose(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const id = tournamentIdOf(input)
	const reason = typeof input.reason === 'string' ? input.reason : ''
	const real = Date.now()
	const saved = commit(nk, logger, id, (t) => closeByModerator(t, reason, nowFor(t, real)))
	logger.info('Tournament %s closed by a moderator', id)
	return JSON.stringify({ id: saved.id, status: saved.status })
}
