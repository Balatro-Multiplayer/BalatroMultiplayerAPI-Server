// The tournament clock: an authoritative Nakama match with no players that
// ticks once a second and, every few seconds, moves along every tournament
// whose due time has come (tournament_due, kept by storage.ts). It lives in
// Nakama itself, so it also runs on Community servers without the API.
//
// It is (re)started by ensureClock, which every tournament RPC calls, and by
// InitModule when Nakama allows it there. If two ever run, the newer one
// stops. A missed tick costs nothing: every RPC catches its tournament up
// first, and the due index keeps everything else.
import { readConfig } from '../config'
import { dueIds } from './storage'

export const CLOCK_MATCH = 'bmp_tournament_clock'
const TOURNAMENT_SWEEP_MAX = 50

export function ensureClock(nk: nkruntime.Nakama): void {
	try {
		const running = nk.matchList(1, true, CLOCK_MATCH, null, null, '')
		if (running && running.length > 0) return
		nk.matchCreate(CLOCK_MATCH, {})
	} catch (e) {
		// Not fatal: the RPC itself catches its tournament up.
	}
}

// Moves along every due tournament (at most TOURNAMENT_SWEEP_MAX per call).
// advanceOne is rpc.ts's catchUpTournament, passed in (rpc.ts's) so this file doesn't import rpc.ts, which imports it.
export function sweep(nk: nkruntime.Nakama, logger: nkruntime.Logger, real: number, advanceOne: (nk: nkruntime.Nakama, id: string, real: number) => unknown): number {
	if (!readConfig(nk).tournamentsEnabled) return 0
	const ids = dueIds(nk, real).slice(0, TOURNAMENT_SWEEP_MAX)
	for (const id of ids) {
		try {
			advanceOne(nk, id, real)
		} catch (e) {
			logger.error('Tournament clock: %s failed: %s', id, e instanceof Error ? e.message : JSON.stringify(e))
		}
	}
	return ids.length
}
