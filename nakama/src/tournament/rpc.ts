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
import { parsePayload, requireUser } from '../rpc'
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
import { TOURNAMENT_MOD_ID, type Input, type Tournament, isManager } from './model'
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

export const TOURNAMENT_ID_PATTERN = /^[0-9a-f-]{36}$/
const LIST_LIMIT = 100

export function tournamentsEnabled(nk: nkruntime.Nakama): boolean {
	return readConfig(nk).tournamentsEnabled
}

function requireEnabled(nk: nkruntime.Nakama) {
	if (!tournamentsEnabled(nk)) throw runtimeError(FAILED_PRECONDITION, 'Tournaments are not enabled on this server')
}

// The tournament's own "now": real time, plus a dev time skip.
export function nowFor(t: Tournament, real: number): number {
	return real + (t.devClockOffsetMs ?? 0)
}

export function ratingsLookup(nk: nkruntime.Nakama, now: number): RatingsLookup {
	return (userIds, board) => {
		const out: { [id: string]: number | undefined } = {}
		const real = userIds.filter((id) => id.indexOf('dev-bot-') !== 0)
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
export function catchUpTournament(nk: nkruntime.Nakama, id: string, real: number): Tournament {
	return mutate(nk, id, (t) => {
		const now = nowFor(t, real)
		const next = advance(t, now, ratingsLookup(nk, now), seededRng(real))
		return next ? { ok: true, value: next } : null
	})
}

function respond(t: Tournament, viewerId: string, real: number): string {
	return JSON.stringify({ tournament: tournamentView(t, viewerId, nowFor(t, real)) })
}

// Applies a lifecycle change at the tournament's own now, settles the
// timetable, saves, and answers with the new view.
function changeTournament(
	nk: nkruntime.Nakama,
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
	catchUpTournament(nk, id, real)
	const saved = mutate(nk, id, (t) => {
		const now = nowFor(t, real)
		const r = apply(t, userId, now, input)
		return r.ok ? { ok: true, value: settleTimetable(r.value, now) } : r
	})
	return respond(saved, userId, real)
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
	entries.sort((a, b) => (want === 'finished' ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : a.startsAt - b.startsAt))
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
	const t = catchUpTournament(nk, id, real)
	const member = readMineIds(nk, userId).indexOf(id) !== -1 || isManager(t, userId)
	const viaCode = typeof input.code === 'string' && input.code.toUpperCase() === t.inviteCode
	if (t.visibility === 'private' && !member && !viaCode) throw runtimeError(NOT_FOUND, 'No such tournament')
	if (t.status === 'draft' && !isManager(t, userId)) throw runtimeError(NOT_FOUND, 'No such tournament')
	return respond(t, userId, real)
}

// {} -> summaries of every tournament the caller organises, helps run,
// plays in or waits for, with their role.
export function rpcTournamentMine(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const real = Date.now()
	ensureClock(nk)
	const ids = readMineIds(nk, userId)
	const entries = readIndexEntries(nk, ids)
	// Catch up the ones that are due, so countdowns and statuses are current.
	const out = entries.map((e) => {
		if (e.status === 'finished' || e.status === 'cancelled' || e.status === 'draft') return e
		const t = catchUpTournament(nk, e.id, real)
		return { ...e, status: t.status, players: t.entrants.length, startsAt: t.startsAt }
	})
	return JSON.stringify({
		serverNow: real,
		tournaments: out.map((e) => ({ ...publicSummary(e), organiser: e.organiserId === userId })),
	})
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
	catchUpTournament(nk, id, real)
	const saved = mutate(nk, id, (t) => {
		if (t.visibility === 'private' && !viaCode) return { ok: false, error: { code: NOT_FOUND, message: 'No such tournament' } }
		return joinTournament(t, { id: userId, name }, nowFor(t, real))
	})
	return respond(saved, userId, real)
}

export function rpcTournamentLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now) => leaveTournament(t, userId, now))
}

export function rpcTournamentCheckIn(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now) => checkInEntrant(t, userId, now))
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
	return changeTournament(nk, ctx, payload, (t, userId, now, input) => {
		const { id, ...settings } = input
		return updateSettings(t, userId, settings, now)
	})
}

export function rpcTournamentOpen(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now) => openRegistration(t, userId, now))
}

// {id, closed: boolean}
export function rpcTournamentRegistrationSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now, input) => {
		if (typeof input.closed !== 'boolean') return { ok: false, error: { code: INVALID_ARGUMENT, message: 'closed must be true or false' } }
		return setRegistrationClosed(t, userId, input.closed, now)
	})
}

// {id, userId}
export function rpcTournamentPromote(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now, input) => promote(t, userId, inputString(input, 'userId'), now))
}

// {id, userId}
export function rpcTournamentRemovePlayer(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now, input) => removePlayer(t, userId, inputString(input, 'userId'), now))
}

// {id, userIds: string[]}
export function rpcTournamentCoOrganisersSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now, input) => {
		const ids = input.userIds
		if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && TOURNAMENT_ID_PATTERN.test(i))) {
			return { ok: false, error: { code: INVALID_ARGUMENT, message: 'userIds must be player ids' } }
		}
		return setCoOrganisers(t, userId, ids as string[], now)
	})
}

// {id, order: string[]} -> manual seeding.
export function rpcTournamentSeedingSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now, input) => {
		const order = input.order
		if (!Array.isArray(order) || !order.every((i) => typeof i === 'string')) {
			return { ok: false, error: { code: INVALID_ARGUMENT, message: 'order must be a list of entrant ids' } }
		}
		return setManualSeeding(t, userId, order as string[], now)
	})
}

// {id} -> starts now (before the scheduled time).
export function rpcTournamentStart(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now) => {
		if (t.organiserId !== userId) return { ok: false, error: { code: PERMISSION_DENIED, message: 'Only the organiser can do that' } }
		return start(t, now, ratingsLookup(nk, now), seededRng(Date.now()))
	})
}

export function rpcTournamentCancel(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, ctx, payload, (t, userId, now) => cancel(t, userId, now))
}
