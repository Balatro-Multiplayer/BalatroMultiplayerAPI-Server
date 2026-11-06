// Dev-server-only helpers for testing tournaments without dozens of game
// clients or hours of waiting. Refused on every other server kind
// (settingsOf(ctx).testingRpcs).
//   tournament_dev_fill {id, count, checkIn?}  adds fake entrants ("Bot 1",
//                                              ...) with random ratings
//   tournament_dev_time {id, minutes}          brings this tournament's times
//                                              (start, deadlines, ...) that
//                                              many minutes closer, then
//                                              catches it up
import { FAILED_PRECONDITION, INVALID_ARGUMENT, PERMISSION_DENIED, runtimeError } from '../errors'
import { parsePayload, requireUser } from '../rpc'
import { settingsOf } from '../server_kind'
import { ensureClock } from './clock'
import { type Entrant, FAKE_ENTRANT_PREFIX, type Tournament, addEvent } from './model'
import { catchUpTournament, nowFor, tournamentIdOf, tournamentsEnabled } from './rpc'
import { readTournament } from './storage'
import { commit } from './effects'
import { tournamentView } from './view'

function requireDev(ctx: nkruntime.Context, nk: nkruntime.Nakama): string {
	if (!settingsOf(ctx).testingRpcs) throw runtimeError(PERMISSION_DENIED, 'Testing RPCs are off on this server')
	if (!tournamentsEnabled(nk)) throw runtimeError(FAILED_PRECONDITION, 'Tournaments are not enabled on this server')
	return requireUser(ctx)
}

export function rpcTournamentDevFill(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	const userId = requireDev(ctx, nk)
	const input = parsePayload(payload)
	const id = tournamentIdOf(input)
	const count = input.count
	if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 128) throw runtimeError(INVALID_ARGUMENT, 'count must be 1-128')
	const checkIn = input.checkIn !== false
	const real = Date.now()
	ensureClock(nk)
	const saved = commit(nk, logger, id, (t) => {
		if (t.status !== 'draft' && t.status !== 'registration' && t.status !== 'check_in') {
			return { ok: false, error: { code: FAILED_PRECONDITION, message: 'Only before the start' } }
		}
		const now = nowFor(t, real)
		const taken = new Set(t.entrants.map((e) => e.userId))
		const bots: Entrant[] = []
		for (let n = 1; bots.length < count && t.entrants.length + bots.length < t.maxPlayers; n++) {
			const botId = `${FAKE_ENTRANT_PREFIX}${n}`
			if (taken.has(botId)) continue
			bots.push({
				userId: botId,
				name: `Bot ${n}`,
				joinedAt: now,
				// Counted as checked in even before check-in opens (they can't press it).
				checkedInAt: checkIn ? now : undefined,
				rating: 400 + Math.floor(Math.random() * 1200),
			})
		}
		const next = addEvent({ ...t, entrants: t.entrants.concat(bots), updatedAt: now }, { at: now, kind: 'dev_fill', count: bots.length })
		return { ok: true, value: next }
	})
	return JSON.stringify({ tournament: tournamentView(saved, userId, nowFor(saved, real)) })
}

// Epoch-ms timestamps (2001 to 5138); nothing else stored gets this big.
const EPOCH_MS_MIN = 1e12
const EPOCH_MS_MAX = 1e14

function shiftTimes(value: unknown, by: number): unknown {
	if (typeof value === 'number') return value >= EPOCH_MS_MIN && value < EPOCH_MS_MAX ? value - by : value
	if (Array.isArray(value)) return value.map((v) => shiftTimes(v, by))
	if (value && typeof value === 'object') {
		const out: { [key: string]: unknown } = {}
		for (const key of Object.keys(value)) out[key] = shiftTimes((value as { [key: string]: unknown })[key], by)
		return out
	}
	return value
}

// Moves every time in the tournament `ms` earlier (as if that long had
// passed), folding in a clock offset left by the old dev_time. The
// tournament's now stays real time, so clients see one consistent clock.
export function skipAhead(t: Tournament, ms: number): Tournament {
	const by = ms + (t.devClockOffsetMs ?? 0)
	const shifted = shiftTimes({ ...t, devClockOffsetMs: undefined }, by) as Tournament
	delete shifted.devClockOffsetMs
	return shifted
}

export function rpcTournamentDevTime(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	const userId = requireDev(ctx, nk)
	const input = parsePayload(payload)
	const id = tournamentIdOf(input)
	const minutes = input.minutes
	// 0 only folds in an old clock offset.
	if (typeof minutes !== 'number' || !(minutes >= 0) || minutes > 60 * 24 * 60) throw runtimeError(INVALID_ARGUMENT, 'minutes must be 0 or more')
	if (!readTournament(nk, id)) throw runtimeError(INVALID_ARGUMENT, 'No such tournament')
	const real = Date.now()
	ensureClock(nk)
	commit(nk, logger, id, (t) => ({ ok: true, value: skipAhead(t, minutes * 60 * 1000) }))
	const saved = catchUpTournament(nk, logger, id, real)
	logger.info('Tournament %s: dev skip %d min', id, minutes)
	return JSON.stringify({ tournament: tournamentView(saved, userId, nowFor(saved, real)) })
}
