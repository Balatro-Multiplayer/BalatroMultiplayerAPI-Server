// The tournament RPCs. Thin: check who is calling and that tournaments are
// switched on, then load -> lifecycle.ts change -> save (storage.ts). Every
// response carries serverNow so clients can show countdowns in local time.
// Each call also catches the tournament up first (advance), so state is never
// staler than the request even if the clock missed a tick.
import { readConfig } from '../config'
import { integrityRefusal, readIntegrity } from '../integrity'
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
	joinAsCoOrganiser,
	setCoOrganiserCode,
	setNotice,
	setCoOrganisers,
	setManualSeeding,
	setRegistrationClosed,
	settleTimetable,
	start,
	updateSettings,
} from './lifecycle'
import { CREATE_PRIVILEGE, OFFICIAL_PRIVILEGE, ORGANISER_MESSAGE_MAX, TOURNAMENT_MOD_ID, type Input, type Tournament, isFakeEntrant, isManager, nowFor, roleOf } from './model'
export { nowFor }
import {
	type IndexEntry,
	insertTournament,
	mutate,
	readIndexEntries,
	readMineIds,
	readTournament,
	reserveCoOrganiserCode,
	reserveInviteCode,
	tournamentIdForCoOrganiserCode,
	scanIndex,
	spendTournamentCreate,
	tournamentIdForCode,
} from './storage'
import { previewTournament, provisionalOf } from './preview'
import { tournamentView } from './view'
import { messageTargets } from './organiser_message'
import { lookupCode } from '../lobby/codes'
import { obscenityMatches } from '../chat/filter'
import { NotifyCode, notify } from '../notify'
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

export const RANKED_PROFILE_NEEDED =
	'Ranked profile required: launch a ranked profile through the BET launcher and keep the launcher open, then try again.'

// A tournament with requireRanked: the ranked queue's rule on top of the entry
// rules -- a launcher verdict while the server enforces it (otherwise the
// allowed mods entry already checks). Not the ranked queue's on/off switch.
export function rankedProfileRefusal(nk: nkruntime.Nakama, ctx: nkruntime.Context, userId: string, now: number): string | null {
	const entry = entryRefusal(nk, ctx, userId, now)
	if (entry) return entry
	return integrityRefusal(readConfig(nk), readIntegrity(nk, userId), now) ? RANKED_PROFILE_NEEDED : null
}

// Throws when the tournament needs a ranked profile the player isn't on.
function requireRankedProfile(nk: nkruntime.Nakama, ctx: nkruntime.Context, id: string, userId: string, now: number) {
	const stored = readTournament(nk, id)
	if (!stored || stored.t.requireRanked !== true) return
	const refused = rankedProfileRefusal(nk, ctx, userId, now)
	if (refused) throw runtimeError(PERMISSION_DENIED, refused)
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

// The viewer's own ranked profile, for a tournament that needs one: whether
// they qualify right now (so the client can warn them early) and why not.
function rankedProfileOf(nk: nkruntime.Nakama, ctx: nkruntime.Context, t: Tournament, userId: string, real: number) {
	if (t.requireRanked !== true) return undefined
	const refused = rankedProfileRefusal(nk, ctx, userId, real)
	return { ok: refused === null, message: refused }
}

function respond(t: Tournament, viewerId: string, real: number, nk?: nkruntime.Nakama, ctx?: nkruntime.Context): string {
	const view = tournamentView(t, viewerId, nowFor(t, real))
	const ranked = nk && ctx ? rankedProfileOf(nk, ctx, t, viewerId, real) : undefined
	return JSON.stringify({ tournament: ranked ? { ...view, rankedProfile: ranked } : view })
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
	return respond(saved, userId, real, nk, ctx)
}

// Making (or keeping) a tournament official needs the official privilege.
function requireOfficialRight(nk: nkruntime.Nakama, userId: string, input: Input) {
	if (input.official !== true) return
	if (profileFor(nk, userId).privileges.indexOf(OFFICIAL_PRIVILEGE) === -1) {
		throw runtimeError(PERMISSION_DENIED, 'Only players with official rights can run official tournaments')
	}
}

// While creation is restricted, only privileged players may create.
export const CREATE_REFUSED = 'Only privileged users can create tournaments currently.'

function canCreate(nk: nkruntime.Nakama, userId: string): boolean {
	if (!readConfig(nk).tournamentCreationRestricted) return true
	const privileges = profileFor(nk, userId).privileges
	return privileges.indexOf(CREATE_PRIVILEGE) !== -1 || privileges.indexOf(OFFICIAL_PRIVILEGE) !== -1
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

// {id, provisional?} -> the full view. With provisional, a tournament that
// hasn't started also gets the bracket it would have now (provisional: true).
// Private tournaments are visible to their members
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
	if (input.provisional !== true || t.bracket) return respond(t, userId, real, nk, ctx)
	// Not started: the bracket as if it started now (the bracket viewer).
	const now = nowFor(t, real)
	const view = tournamentView(t, userId, now)
	const drawn = provisionalOf(t, userId, now, ratingsLookup(nk, now))
	const ranked = rankedProfileOf(nk, ctx, t, userId, real)
	const withRanked = ranked ? { ...view, rankedProfile: ranked } : view
	if (!drawn) return JSON.stringify({ tournament: withRanked })
	return JSON.stringify({ tournament: { ...withRanked, bracket: drawn.bracket, standings: drawn.standings, schedule: drawn.schedule, provisional: true } })
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
	// Whether the caller is on a ranked profile, for the ones that need it.
	let rankedOk: boolean | null = null
	const rankedOkNow = () => {
		if (rankedOk === null) rankedOk = rankedProfileRefusal(nk, ctx, userId, real) === null
		return rankedOk
	}
	const out = entries.map((e) => {
		const over = e.status === 'finished' || e.status === 'cancelled' || e.status === 'draft'
		const t = over ? (readTournament(nk, e.id) || { t: null }).t : catchUpTournament(nk, logger, e.id, real)
		if (!t) return { ...publicSummary(e), organiser: e.organiserId === userId, role: 'none' }
		const role = roleOf(t, userId)
		const playing = role === 'entrant' || role === 'waitlist'
		const live = t.status === 'registration' || t.status === 'check_in' || t.status === 'running'
		return {
			...publicSummary({ ...e, status: t.status, players: t.entrants.length, startsAt: t.startsAt }),
			organiser: e.organiserId === userId,
			role,
			rankedOk: t.requireRanked === true && playing && live ? rankedOkNow() : undefined,
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
	requireRankedProfile(nk, ctx, id, userId, real)
	const name = displayNameFor(nk, ctx, userId)
	ensureClock(nk)
	catchUpTournament(nk, logger, id, real)
	const saved = commit(nk, logger, id, (t) => {
		if (t.visibility === 'private' && !viaCode) return { ok: false, error: { code: NOT_FOUND, message: 'No such tournament' } }
		return joinTournament(t, { id: userId, name }, nowFor(t, real))
	})
	return respond(saved, userId, real, nk, ctx)
}

export function rpcTournamentLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now) => leaveTournament(t, userId, now))
}

export function rpcTournamentCheckIn(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireRankedProfile(nk, ctx, tournamentIdOf(parsePayload(payload)), requireUser(ctx), Date.now())
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
	if (!canCreate(nk, userId)) throw runtimeError(PERMISSION_DENIED, CREATE_REFUSED)
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

// {} -> {canCreate}: whether the caller may create a tournament now (the
// organiser's NEW TOURNAMENT asks before opening the wizard).
export function rpcTournamentCanCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	return JSON.stringify({ canCreate: canCreate(nk, requireUser(ctx)) })
}

// {settings, players, step} -> {tournament, steps, step}: the bracket the
// settings would make with `players` dummy players, played up to round
// `step` (create wizard preview). Saves nothing.
export function rpcTournamentPreview(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	requireUser(ctx)
	const input = parsePayload(payload)
	const settings = input.settings
	if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw runtimeError(INVALID_ARGUMENT, 'settings must be an object')
	const players = typeof input.players === 'number' ? input.players : Number.NaN
	const step = typeof input.step === 'number' ? input.step : 0
	const r = previewTournament(settings as Input, players, step, Date.now())
	if (!r.ok) throw runtimeError(INVALID_ARGUMENT, r.error)
	return JSON.stringify(r.value)
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

// {id, text} -> the notice board on the tournament screen; '' clears it.
// Organisers and co-organisers.
export function rpcTournamentNoticeSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	return changeTournament(nk, logger, ctx, payload, (t, userId, now, input) =>
		setNotice(t, userId, typeof input.text === 'string' ? input.text : '', now),
	)
}

// {id, text, matchId?} -> {sent}: an organiser's message into the chat of
// one match's lobby, or of every live match lobby, plus a banner for its
// players. Organisers and co-organisers; the word filter applies.
export function rpcTournamentMessage(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const id = tournamentIdOf(input)
	const text = typeof input.text === 'string' ? input.text.trim() : ''
	if (!text) throw runtimeError(INVALID_ARGUMENT, 'The message is empty')
	if (text.length > ORGANISER_MESSAGE_MAX) throw runtimeError(INVALID_ARGUMENT, `The message can be at most ${ORGANISER_MESSAGE_MAX} characters`)
	if (obscenityMatches(text).length > 0) throw runtimeError(INVALID_ARGUMENT, 'Message blocked by the word filter')
	const stored = readTournament(nk, id)
	if (!stored) throw runtimeError(NOT_FOUND, 'No such tournament')
	const t = stored.t
	if (!isManager(t, userId)) throw runtimeError(PERMISSION_DENIED, 'Only the organisers can do that')
	const matchId = typeof input.matchId === 'string' && input.matchId ? input.matchId : null
	const targets = messageTargets(t, matchId)
	if (targets.length === 0) throw runtimeError(FAILED_PRECONDITION, matchId ? 'That match has no lobby open' : 'No match lobby is open')
	const name = displayNameFor(nk, ctx, userId)
	let sent = 0
	for (const target of targets) {
		try {
			const live = lookupCode(nk, target.code)
			if (live) {
				nk.matchSignal(live.matchId, JSON.stringify({ type: 'organiser_post', name, text }))
				sent++
			}
		} catch (e) {
			logger.warn('Tournament %s: message to lobby %s failed: %s', id, target.code, String(e))
		}
		// The banner reaches them wherever they are (chat may be closed).
		for (const player of target.players) {
			notify(nk, player, NotifyCode.TOURNAMENT_UPDATED, `${t.name}: message from the organiser`, {
				tournamentId: id,
				name: t.name,
				kind: 'organiser_message',
				matchId: target.matchId,
				from: name,
				text,
			})
		}
	}
	logger.info('Tournament %s: organiser message to %d lobbies', id, sent)
	return JSON.stringify({ sent })
}

// {id} -> a new co-organiser code (the organiser shares it); the old one
// stops working.
export function rpcTournamentCoOrganiserCode(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const id = tournamentIdOf(parsePayload(payload))
	const stored = readTournament(nk, id)
	if (!stored) throw runtimeError(NOT_FOUND, 'No such tournament')
	if (stored.t.organiserId !== userId) throw runtimeError(PERMISSION_DENIED, 'Only the organiser can do that')
	const code = reserveCoOrganiserCode(nk, id, stored.t.coOrganiserCode)
	return changeTournament(nk, logger, ctx, payload, (t, uid, now) => setCoOrganiserCode(t, uid, code, now))
}

// {code} -> the caller becomes a co-organiser of that tournament.
export function rpcTournamentCoOrganiserJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireEnabled(nk)
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
	const id = code ? tournamentIdForCoOrganiserCode(nk, code) : null
	if (!id) throw runtimeError(NOT_FOUND, 'That code is not valid')
	const name = displayNameFor(nk, ctx, userId)
	const real = Date.now()
	ensureClock(nk)
	catchUpTournament(nk, logger, id, real)
	const saved = commit(nk, logger, id, (t) => joinAsCoOrganiser(t, { id: userId, name }, code, nowFor(t, real)))
	return respond(saved, userId, real, nk, ctx)
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
	const asked = parsePayload(payload)
	if (asked.ready !== false) requireRankedProfile(nk, ctx, tournamentIdOf(asked), requireUser(ctx), Date.now())
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
