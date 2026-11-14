import { describe, expect, it } from 'vitest'
import { unreportedPlayer } from '../../../testing/pvp_fixtures'
import type { ClockRules, ModeView, PvpRoundPlayer } from '../state'
import { emptyPvp } from '../state'
import { openRound } from './common'

const PVP_CLOCK: ClockRules = {
	ante: 'bank',
	pvp: { baseMs: 60_000, handMs: 10_000 },
	personal: null,
}
const NO_PVP_CLOCK: ClockRules = { ante: 'bank', pvp: null, personal: null }

function shop(
	clocks: ClockRules,
	players: { [id: string]: PvpRoundPlayer },
): ModeView {
	const base = emptyPvp()
	return {
		...base,
		rules: {
			runId: 'r1',
			mode: 'royale',
			startedCount: 2,
			startingLives: 4,
			hunterLives: 7,
			deathOnRoundLoss: true,
			pvpStartAnte: 2,
			clocks,
			timerBaseMs: 150_000,
			timerForgiveness: 0,
			timerIncrementMs: null,
			skipTimeRule: 'lead',
		},
		round: { ...base.round, runId: 'r1', phase: 'shop', players },
	}
}

describe('openRound and the PvP clock', () => {
	it('gives every player the ruleset PvP allowance', () => {
		const opened = openRound(
			shop(PVP_CLOCK, { a: unreportedPlayer(), b: unreportedPlayer() }),
		)
		expect(opened.round.players.a.pvpLeftMs).toBe(60_000)
		expect(opened.round.players.b.pvpLeftMs).toBe(60_000)
	})

	it('leaves it unknown (null) for a ruleset with no PvP clock', () => {
		const opened = openRound(shop(NO_PVP_CLOCK, { a: unreportedPlayer() }))
		expect(opened.round.players.a.pvpLeftMs).toBeNull()
	})

	it('replaces what the last round left, and clears the hand counters', () => {
		const spent = unreportedPlayer({
			pvpLeftMs: 1234,
			committedHands: 2,
			creditedHands: 1,
		})
		const opened = openRound(shop(PVP_CLOCK, { a: spent }))
		expect(opened.round.players.a.pvpLeftMs).toBe(60_000)
		expect(opened.round.players.a.committedHands).toBeNull()
		expect(opened.round.players.a.creditedHands).toBeNull()
	})
})
