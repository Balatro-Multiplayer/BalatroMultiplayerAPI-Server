// Everything that happens to a tournament, as pure functions over the stored
// record: the RPCs (rpc.ts) and the clock (clock.ts) load it, call one of
// these, and save the result. `now` is always passed in.
//
// draft -> registration -> (check_in) -> running -> finished; cancelled from
// any state before finished. Registration closes when check-in opens (or the
// organiser closes it early). At the start, entrants who didn't check in are
// removed, the rest are seeded and the bracket and timetable are built; from
// then on advance() runs the engine's timetable.
import { FAILED_PRECONDITION, INVALID_ARGUMENT, NOT_FOUND, PERMISSION_DENIED } from '../errors'
import { type Result, err, ok } from '../shared/result'
import { createBracket, recordGame, setRoundBestOf } from './engine/bracket'
import { resolveBracket } from './engine/resolve'
import { lobbiesToClose } from './lobby_state'
import { splitGroups } from './engine/round_robin'
import { MINUTE_MS, type ScheduleBlock, newTimetable, presetSchedule, roundSteps, setReady, tickTimetable, validateSchedule } from './engine/schedule'
import { type Rng, seedEntrants } from './engine/seeding'
import type { Bracket, Format, Side } from './engine/types'
import {
	CO_ORGANISERS_MAX,
	type Entrant,
	type Input,
	TOURNAMENT_MOD_ID,
	type Tournament,
	type TournamentEvent,
	addEvent,
	isFakeEntrant,
	isManager,
	roleOf,
	roundSettingsFor,
	validSettings,
} from './model'

export interface LifecycleError {
	code: number
	message: string
}

export type Change = Result<Tournament, LifecycleError>


function fail(code: number, message: string): { ok: false; error: LifecycleError } {
	return err({ code, message })
}

export function touch(t: Tournament, now: number): Tournament {
	return { ...t, updatedAt: now }
}

export function withEvent(t: Tournament, now: number, kind: string, fields: { [key: string]: unknown } = {}): Tournament {
	return addEvent(t, { at: now, kind, ...fields } as TournamentEvent)
}

export function createTournament(
	id: string,
	organiser: { id: string; name: string },
	input: Input,
	inviteCode: string,
	now: number,
): Change {
	const settings = validSettings(input, now, false)
	if (!settings.ok) return fail(INVALID_ARGUMENT, settings.error)
	// Settings first, so nothing an organiser sends can overwrite the rest.
	const t: Tournament = {
		...(settings.value as Required<typeof settings.value>),
		id,
		schema: 1,
		modId: TOURNAMENT_MOD_ID,
		organiserId: organiser.id,
		organiserName: organiser.name,
		coOrganiserIds: [],
		inviteCode,
		status: 'draft',
		registrationClosed: false,
		entrants: [],
		waitlist: [],
		dropped: [],
		events: [],
		createdAt: now,
		updatedAt: now,
	} as Tournament
	const fits = checkTimetable(t)
	if (!fits.ok) return fits
	return ok(withEvent(t, now, 'created'))
}

// A bracket of the tournament's format with `players` entrants, to check
// settings against before anyone has joined.
function sampleBracket(t: Tournament, players: number): Bracket | null {
	const ids: string[] = []
	for (let i = 0; i < players; i++) ids.push(`s${i}`)
	const r = createBracket(t.format, ids, fittedFormatOptions(t.format, t.formatOptions, players), 1)
	return r.ok ? r.value : null
}

// Format options adjusted to the real number of players: fewer Swiss rounds
// than players, and a group size that leaves nobody alone.
export function fittedFormatOptions(format: Format, options: Tournament['formatOptions'], players: number): Tournament['formatOptions'] {
	const out = { ...options }
	if (format === 'swiss' && out.swissRounds !== undefined) out.swissRounds = Math.max(1, Math.min(out.swissRounds, players - 1))
	if (format === 'round_robin') {
		let size = Math.max(2, out.groupSize ?? players)
		while (size < players && splitGroups(new Array(players).fill('x'), size).some((g) => g.length < 2)) size++
		out.groupSize = Math.min(size, players)
	}
	return out
}

// The timetable's blocks for a real bracket. A preset is built for it; a
// custom timetable is fitted: blocks past the last round are dropped and the
// last block runs to the end.
export function scheduleFor(t: Tournament, bracket: Bracket): ScheduleBlock[] {
	const steps = roundSteps(bracket).length
	let blocks: ScheduleBlock[]
	if (t.timetable.kind === 'preset') {
		const o = t.timetable.options
		blocks = presetSchedule(bracket, t.timetable.preset, o).map((b) => ({
			...b,
			seriesReadyUpMinutes: o.seriesReadyUpMinutes ?? b.seriesReadyUpMinutes,
			unplayed: {
				fallbackAfterHours: o.fallbackAfterHours ?? b.unplayed.fallbackAfterHours,
				fallback: o.fallback ?? b.unplayed.fallback,
			},
		}))
	} else {
		// Keep blocks until one reaches the last round; later ones have no rounds.
		blocks = []
		for (const b of t.timetable.blocks) {
			blocks.push({ ...b })
			if (b.untilStep >= steps) break
		}
	}
	if (blocks.length > 0) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], untilStep: steps }
	for (let i = 0; i < blocks.length - 1; i++) blocks[i] = { ...blocks[i], untilStep: Math.min(blocks[i].untilStep, steps) }
	return blocks
}

// Checks the timetable fits the smallest and the largest bracket possible.
function checkTimetable(t: Tournament): Result<true, LifecycleError> {
	for (const n of [2, t.maxPlayers]) {
		const bracket = sampleBracket(t, n)
		if (!bracket) return fail(INVALID_ARGUMENT, `The format options don't work with ${n} players`)
		const valid = validateSchedule(bracket, scheduleFor(t, bracket))
		if (!valid.ok) return fail(INVALID_ARGUMENT, `timetable: ${valid.error.message}`)
	}
	return ok(true)
}

function managerOnly(t: Tournament, userId: string): Result<true, LifecycleError> {
	if (!isManager(t, userId)) return fail(PERMISSION_DENIED, 'Only the organisers can do that')
	return ok(true)
}

function organiserOnly(t: Tournament, userId: string): Result<true, LifecycleError> {
	if (t.organiserId !== userId) return fail(PERMISSION_DENIED, 'Only the organiser can do that')
	return ok(true)
}

function notOver(t: Tournament): Result<true, LifecycleError> {
	if (t.status === 'finished' || t.status === 'cancelled') return fail(FAILED_PRECONDITION, `The tournament is ${t.status}`)
	return ok(true)
}

// Before the start everything is editable. Once running, only the name,
// description and round settings: a series length change applies to rounds
// that haven't started (the bracket itself is fixed).
export function updateSettings(t: Tournament, userId: string, input: Input, now: number): Change {
	const allowed = organiserOnly(t, userId)
	if (!allowed.ok) return allowed
	const over = notOver(t)
	if (!over.ok) return over
	const settings = validSettings(input, now, true)
	if (!settings.ok) return fail(INVALID_ARGUMENT, settings.error)
	const fields = settings.value
	if (t.status === 'running') {
		const locked = Object.keys(fields).filter((k) => ['name', 'description', 'rounds'].indexOf(k) === -1)
		if (locked.length > 0) return fail(FAILED_PRECONDITION, `Can't change ${locked.join(', ')} after the start`)
	}
	if (fields.maxPlayers !== undefined && fields.maxPlayers < t.entrants.length) {
		return fail(FAILED_PRECONDITION, `${t.entrants.length} players have already joined`)
	}
	let next: Tournament = { ...t, ...fields }
	if (t.status !== 'running') {
		const fits = checkTimetable(next)
		if (!fits.ok) return fits
	}
	if (t.status === 'running' && fields.rounds && next.bracket) {
		let bracket = next.bracket
		for (const step of roundSteps(bracket)) {
			for (const r of step) {
				const changed = setRoundBestOf(bracket, r.stage, r.round, roundSettingsFor(next, r.stage, r.round).bestOf)
				if (changed.ok) bracket = changed.value
			}
		}
		next = { ...next, bracket }
	}
	return ok(touch(withEvent(next, now, 'settings_changed'), now))
}

export function openRegistration(t: Tournament, userId: string, now: number): Change {
	const allowed = organiserOnly(t, userId)
	if (!allowed.ok) return allowed
	if (t.status !== 'draft') return fail(FAILED_PRECONDITION, 'Registration is already open')
	if (t.startsAt <= now) return fail(FAILED_PRECONDITION, 'The start time has passed; move it first')
	return ok(touch(withEvent({ ...t, status: 'registration' }, now, 'registration_opened'), now))
}

export function setRegistrationClosed(t: Tournament, userId: string, closed: boolean, now: number): Change {
	const allowed = organiserOnly(t, userId)
	if (!allowed.ok) return allowed
	if (t.status !== 'registration') return fail(FAILED_PRECONDITION, 'Registration is not open')
	return ok(touch(withEvent({ ...t, registrationClosed: closed }, now, closed ? 'registration_closed' : 'registration_reopened'), now))
}

export function joinTournament(t: Tournament, user: { id: string; name: string }, now: number): Change {
	if (t.status !== 'registration' || t.registrationClosed) return fail(FAILED_PRECONDITION, 'Registration is closed')
	const role = roleOf(t, user.id)
	if (role === 'entrant' || role === 'waitlist' || t.entrants.some((e) => e.userId === user.id)) {
		return fail(FAILED_PRECONDITION, 'You have already joined')
	}
	const entrant: Entrant = { userId: user.id, name: user.name, joinedAt: now }
	if (t.entrants.length < t.maxPlayers) {
		return ok(touch(withEvent({ ...t, entrants: t.entrants.concat([entrant]) }, now, 'joined', { userId: user.id }), now))
	}
	return ok(touch(withEvent({ ...t, waitlist: t.waitlist.concat([entrant]) }, now, 'waitlisted', { userId: user.id }), now))
}

// Leaving before the start removes the player; once running it is a drop
// (their unfinished matches are forfeited).
export function leaveTournament(t: Tournament, userId: string, now: number): Change {
	const over = notOver(t)
	if (!over.ok) return over
	if (t.waitlist.some((e) => e.userId === userId)) {
		return ok(touch(withEvent({ ...t, waitlist: t.waitlist.filter((e) => e.userId !== userId) }, now, 'left', { userId }), now))
	}
	if (!t.entrants.some((e) => e.userId === userId)) return fail(FAILED_PRECONDITION, 'You are not in this tournament')
	if (t.status === 'running') {
		if (t.dropped.indexOf(userId) !== -1) return fail(FAILED_PRECONDITION, 'You have already left')
		return ok(touch(withEvent({ ...t, dropped: t.dropped.concat([userId]) }, now, 'dropped', { userId }), now))
	}
	return ok(touch(withEvent({ ...t, entrants: t.entrants.filter((e) => e.userId !== userId) }, now, 'left', { userId }), now))
}

// An organiser or co-organiser removes a player (same effect as them leaving).
export function removePlayer(t: Tournament, managerId: string, userId: string, now: number): Change {
	const allowed = managerOnly(t, managerId)
	if (!allowed.ok) return allowed
	const r = leaveTournament(t, userId, now)
	if (!r.ok) return r
	return ok(withEvent(r.value, now, 'removed_by_organiser', { userId, by: managerId }))
}

export function checkInEntrant(t: Tournament, userId: string, now: number): Change {
	if (t.status !== 'check_in') return fail(FAILED_PRECONDITION, 'Check-in is not open')
	const index = t.entrants.findIndex((e) => e.userId === userId)
	if (index === -1) return fail(FAILED_PRECONDITION, 'You are not in this tournament')
	if (t.entrants[index].checkedInAt !== undefined) return ok(t)
	const entrants = t.entrants.slice()
	entrants[index] = { ...entrants[index], checkedInAt: now }
	return ok(touch(withEvent({ ...t, entrants }, now, 'checked_in', { userId }), now))
}

// The organiser moves a waitlisted player into the tournament (no automatic
// promotion: Lex's rule).
export function promote(t: Tournament, managerId: string, userId: string, now: number): Change {
	const allowed = managerOnly(t, managerId)
	if (!allowed.ok) return allowed
	if (t.status !== 'registration' && t.status !== 'check_in' && t.status !== 'draft') return fail(FAILED_PRECONDITION, 'The tournament has started')
	const waiting = t.waitlist.find((e) => e.userId === userId)
	if (!waiting) return fail(NOT_FOUND, 'That player is not on the waitlist')
	if (t.entrants.length >= t.maxPlayers) return fail(FAILED_PRECONDITION, 'The tournament is full; raise the player limit first')
	const promoted: Entrant = t.status === 'check_in' ? { ...waiting, checkedInAt: now } : waiting
	return ok(
		touch(
			withEvent({ ...t, entrants: t.entrants.concat([promoted]), waitlist: t.waitlist.filter((e) => e.userId !== userId) }, now, 'promoted', { userId }),
			now,
		),
	)
}

export function setCoOrganisers(t: Tournament, userId: string, ids: string[], now: number): Change {
	const allowed = organiserOnly(t, userId)
	if (!allowed.ok) return allowed
	const unique = ids.filter((id, i) => ids.indexOf(id) === i && id !== t.organiserId)
	if (unique.length > CO_ORGANISERS_MAX) return fail(INVALID_ARGUMENT, `At most ${CO_ORGANISERS_MAX} co-organisers`)
	return ok(touch(withEvent({ ...t, coOrganiserIds: unique }, now, 'co_organisers_set'), now))
}

export function setManualSeeding(t: Tournament, userId: string, order: string[], now: number): Change {
	const allowed = organiserOnly(t, userId)
	if (!allowed.ok) return allowed
	if (t.status === 'running' || t.status === 'finished' || t.status === 'cancelled') return fail(FAILED_PRECONDITION, 'Seeding is locked once the tournament starts')
	const known = new Set(t.entrants.map((e) => e.userId))
	if (order.some((id) => !known.has(id)) || new Set(order).size !== order.length) {
		return fail(INVALID_ARGUMENT, 'The seeding must list entrants, each once')
	}
	return ok(touch(withEvent({ ...t, seeding: { ...t.seeding, kind: 'manual', order } }, now, 'seeding_set'), now))
}

export function cancel(t: Tournament, userId: string, now: number, reason = 'organiser'): Change {
	const allowed = organiserOnly(t, userId)
	if (!allowed.ok) return allowed
	const over = notOver(t)
	if (!over.ok) return over
	return ok(touch(withEvent({ ...t, status: 'cancelled', finishedAt: now }, now, 'cancelled', { reason }), now))
}

// A moderator closes a tournament (server-only admin RPC): like a cancel,
// for any tournament not over, recorded with the reason.
export function closeByModerator(t: Tournament, reason: string, now: number): Change {
	const over = notOver(t)
	if (!over.ok) return over
	return ok(touch(withEvent({ ...t, status: 'cancelled', finishedAt: now }, now, 'cancelled', { reason: 'moderator', message: reason.slice(0, 200) }), now))
}

export type RatingsLookup = (userIds: string[], board: string) => { [userId: string]: number | undefined }

// Starts the tournament now: check-in removals, seeding, bracket, timetable.
export function start(t: Tournament, now: number, ratingsFor: RatingsLookup, rng: Rng): Change {
	if (t.status !== 'registration' && t.status !== 'check_in') return fail(FAILED_PRECONDITION, 'The tournament cannot start from here')
	const checkedIn = t.checkInMinutes === null || t.status !== 'check_in' ? t.entrants : t.entrants.filter((e) => e.checkedInAt !== undefined)
	const noShows = t.entrants.filter((e) => checkedIn.indexOf(e) === -1).map((e) => e.userId)
	let next: Tournament = { ...t, entrants: checkedIn }
	if (noShows.length > 0) next = withEvent(next, now, 'no_shows_removed', { userIds: noShows })
	if (checkedIn.length < 2) {
		return ok(touch(withEvent({ ...next, status: 'cancelled', finishedAt: now }, now, 'cancelled', { reason: 'not_enough_players' }), now))
	}

	const board = t.seeding.board ?? `ranked:${t.rounds.defaults.ruleset}`
	const ratings = t.seeding.kind === 'rating' ? ratingsFor(checkedIn.map((e) => e.userId), board) : {}
	const rated = checkedIn.map((e) => ({ ...e, rating: ratings[e.userId] ?? null }))
	let order: string[] | undefined
	if (t.seeding.kind === 'manual') {
		// Anyone the organiser didn't place goes after, in sign-up order.
		const placed = (t.seeding.order ?? []).filter((id) => rated.some((e) => e.userId === id))
		order = placed.concat(rated.map((e) => e.userId).filter((id) => placed.indexOf(id) === -1))
	}
	const seeded = seedEntrants(
		rated.map((e) => ({ id: e.userId, rating: e.rating })),
		t.seeding.kind,
		{ rng, order },
	)
	if (!seeded.ok) return fail(INVALID_ARGUMENT, seeded.error.message)

	const formatOptions = fittedFormatOptions(t.format, t.formatOptions, seeded.value.length)
	const built = createBracket(t.format, seeded.value, formatOptions, t.rounds.defaults.bestOf)
	if (!built.ok) return fail(INVALID_ARGUMENT, built.error.message)
	let bracket = built.value
	for (const step of roundSteps(bracket)) {
		for (const r of step) {
			const changed = setRoundBestOf(bracket, r.stage, r.round, roundSettingsFor(t, r.stage, r.round, bracket).bestOf)
			if (changed.ok) bracket = changed.value
		}
	}
	const schedule = scheduleFor({ ...t, formatOptions }, bracket)
	const valid = validateSchedule(bracket, schedule)
	if (!valid.ok) return fail(INVALID_ARGUMENT, `timetable: ${valid.error.message}`)

	next = {
		...next,
		entrants: rated,
		formatOptions,
		status: 'running',
		registrationClosed: true,
		startedAt: now,
		bracket,
		schedule,
		clock: newTimetable(now, schedule),
	}
	next = withEvent(next, now, 'started', { players: seeded.value.length })
	return ok(touch(advanceRunning(next, now), now))
}

function tickOnce(t: Tournament, now: number): Tournament {
	if (!t.bracket || !t.schedule || !t.clock) return t
	const out = tickTimetable({
		bracket: t.bracket,
		schedule: t.schedule,
		state: t.clock,
		now,
		dropped: t.dropped,
		bestOfFor: (stage, round) => roundSettingsFor(t, stage, round).bestOf,
	})
	let next: Tournament = { ...t, bracket: out.bracket, clock: out.state, nextWakeAt: out.nextWakeAt }
	for (const e of out.events) {
		const { kind, ...fields } = e
		next = withEvent(next, now, kind, fields)
	}
	if (out.state.finishedAt !== undefined && next.status === 'running') {
		next = withEvent({ ...next, status: 'finished', finishedAt: now, nextWakeAt: null }, now, 'tournament_finished')
	}
	return next
}

// Dev-server bots (fake entrants) ready up as soon as a ready-up opens and
// play their games at once: a random winner between two bots, the human
// against a bot. Returns null when no bot had anything to do.
function botsAct(t: Tournament, now: number): Tournament | null {
	if (!t.bracket || !t.clock) return null
	let clock = t.clock
	let bracket = t.bracket
	let acted = false
	const resolved = resolveBracket(bracket, t.dropped)
	for (const matchId of Object.keys(clock.matches)) {
		const m = resolved.byId[matchId]
		const c = clock.matches[matchId]
		if (!m || typeof m.players[0] !== 'string' || typeof m.players[1] !== 'string') continue
		const pair: [string, string] = [m.players[0], m.players[1]]
		const bots: [boolean, boolean] = [isFakeEntrant(pair[0]), isFakeEntrant(pair[1])]
		if (!bots[0] && !bots[1]) continue
		if (c.phase === 'ready_up') {
			for (const side of [0, 1] as Side[]) {
				if (!bots[side] || c.ready[side]) continue
				const r = setReady(clock, matchId, side, true, now)
				if (r.ok) {
					clock = r.value
					acted = true
				}
			}
		} else if (c.phase === 'in_game') {
			// Deterministic per match and game, so a retried save plays the same.
			const coin = (matchId.length * 7 + m.def.games.length * 13 + now) % 2 === 0 ? 0 : 1
			const winner: Side = bots[0] && bots[1] ? (coin as Side) : bots[0] ? 1 : 0
			const r = recordGame(bracket, matchId, winner, t.dropped)
			if (r.ok) {
				bracket = r.value
				acted = true
			}
		}
	}
	return acted ? { ...t, bracket, clock } : null
}

// Runs the timetable, letting bots act between passes until they have
// nothing left to do.
function advanceRunning(t: Tournament, now: number): Tournament {
	let next = tickOnce(t, now)
	for (let i = 0; i < 1000 && next.status === 'running'; i++) {
		const acted = botsAct(next, now)
		if (!acted) break
		next = tickOnce(acted, now)
	}
	return next
}

// When the clock next needs to look at this tournament (null: only a player
// or organiser action can change anything).
export function wakeAt(t: Tournament): number | null {
	// A lobby to close (match decided, tournament over): due now.
	if (lobbiesToClose(t).length > 0) return t.updatedAt
	if (t.status === 'registration') {
		const checkInAt = t.checkInMinutes === null ? null : t.startsAt - t.checkInMinutes * MINUTE_MS
		return checkInAt !== null && checkInAt < t.startsAt ? checkInAt : t.startsAt
	}
	if (t.status === 'check_in') return t.startsAt
	if (t.status === 'running') return t.nextWakeAt ?? null
	return null
}

// Moves the tournament along to `now`: opens check-in, starts it, runs the
// timetable. Returns null when nothing changed.
export function advance(t: Tournament, now: number, ratingsFor: RatingsLookup, rng: Rng): Tournament | null {
	let next = t
	if (next.status === 'registration' && next.checkInMinutes !== null && now >= next.startsAt - next.checkInMinutes * MINUTE_MS && now < next.startsAt) {
		next = touch(withEvent({ ...next, status: 'check_in', registrationClosed: true }, now, 'check_in_opened'), now)
	}
	if ((next.status === 'registration' || next.status === 'check_in') && now >= next.startsAt) {
		const started = start(next, now, ratingsFor, rng)
		next = started.ok ? started.value : touch(withEvent({ ...next, status: 'cancelled', finishedAt: now }, now, 'cancelled', { reason: 'start_failed', message: started.error.message }), now)
	} else if (next.status === 'running') {
		const wake = next.nextWakeAt
		if (wake !== null && wake !== undefined && wake <= now) next = touch(advanceRunning(next, now), now)
	}
	return next === t ? null : next
}

// The timetable after a player or organiser action: run it at once so the
// effect (e.g. a newly opened match) is visible in the same response.
export function settleTimetable(t: Tournament, now: number): Tournament {
	return t.status === 'running' ? touch(advanceRunning(t, now), now) : t
}
