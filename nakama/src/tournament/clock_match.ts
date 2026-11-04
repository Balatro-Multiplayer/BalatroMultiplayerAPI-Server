// The match handlers behind the tournament clock (clock.ts). Registered in
// main.ts as 'bmp_tournament_clock'. Nobody can join it.
import { CLOCK_MATCH, sweep } from './clock'
import { catchUpTournament } from './rpc'

interface ClockState {
	ticks: number
}

const SWEEP_EVERY_TICKS = 5
const DUPLICATE_CHECK_EVERY_TICKS = 60

export function tournamentClockInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
	logger.info('Tournament clock started')
	return { state: { ticks: 0 } as ClockState, tickRate: 1, label: CLOCK_MATCH }
}

export function tournamentClockJoinAttempt(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: ClockState,
	presence: nkruntime.Presence,
	metadata: { [key: string]: string },
) {
	return { state, accept: false, rejectMessage: 'Not a lobby' }
}

export function tournamentClockJoin(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: ClockState,
	presences: nkruntime.Presence[],
) {
	return { state }
}

export function tournamentClockLeave(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: ClockState,
	presences: nkruntime.Presence[],
) {
	return { state }
}

export function tournamentClockLoop(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: ClockState,
	messages: nkruntime.MatchMessage[],
) {
	const ticks = state.ticks + 1
	// Two clocks (two RPCs racing to start one): the one with the larger id stops.
	if (ticks % DUPLICATE_CHECK_EVERY_TICKS === 0) {
		try {
			const clocks = nk.matchList(10, true, CLOCK_MATCH, null, null, '')
			if (clocks.some((m) => m.matchId < ctx.matchId)) {
				logger.info('Tournament clock %s: another clock is running, stopping', ctx.matchId)
				return null
			}
		} catch (e) {
			// Keep running.
		}
	}
	if (ticks % SWEEP_EVERY_TICKS === 0) {
		try {
			sweep(nk, logger, Date.now(), catchUpTournament)
		} catch (e) {
			logger.error('Tournament clock sweep failed: %s', e instanceof Error ? e.message : JSON.stringify(e))
		}
	}
	return { state: { ticks } }
}

export function tournamentClockSignal(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: ClockState,
	data: string,
) {
	return { state, data: '' }
}

export function tournamentClockTerminate(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: ClockState,
	graceSeconds: number,
) {
	return { state }
}
