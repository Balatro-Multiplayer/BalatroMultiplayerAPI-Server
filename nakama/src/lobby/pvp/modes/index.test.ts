import { describe, expect, it } from 'vitest'
import { testContext } from '../../../testing/request_context'
import { emptyPvp } from '../state'
import { duelMode } from './duel'
import { pickMode } from './index'
import { manhuntMode } from './manhunt'
import { nemesisMode } from './nemesis'
import { royaleMode } from './royale'
import { teamsMode } from './teams'

describe('pickMode', () => {
	it.each([
		['royale', 2, duelMode],
		['royale', 16, royaleMode],
		['nemesis', 2, duelMode],
		['nemesis', 3, nemesisMode],
		['manhunt', 2, manhuntMode],
		['manhunt', 8, manhuntMode],
		['teams', 2, teamsMode],
		['teams', 8, teamsMode],
	] as const)('%s with %i players', (mode, count, expected) => {
		expect(pickMode(mode, count)).toBe(expected)
	})
})

describe('pickMode with the alive count', () => {
	it.each([
		['royale', 6],
		['nemesis', 3],
	] as const)(
		'%s started with %i: two alive play the duel round rules',
		(mode, started) => {
			const picked = pickMode(mode, started, 2)
			const base = pickMode(mode, started)
			expect(picked.resolveRound).toBe(duelMode.resolveRound)
			// the death, hands and win rules stay those of the game's own mode
			expect(picked.name).toBe(base.name)
			expect(picked.deathPolicy).toBe(base.deathPolicy)
			expect(picked.outOfHandsOnFail).toBe(base.outOfHandsOnFail)
			expect(picked.checkWinner).toBe(base.checkWinner)
		},
	)

	it.each([
		['royale', 4, 3, royaleMode],
		['royale', 4, 4, royaleMode],
		['nemesis', 4, 3, nemesisMode],
		['manhunt', 4, 2, manhuntMode],
		['teams', 4, 2, teamsMode],
		['royale', 2, 2, duelMode],
	] as const)('%s started with %i, %i alive', (mode, started, alive, expected) => {
		expect(pickMode(mode, started, alive)).toBe(expected)
	})
})

// Each mode's choices for the shared code. These replaced checks on the mode's
// name, so a changed value here changes a rule.
describe('mode policies', () => {
	it.each([
		['duel', duelMode, 'opponent', false, false, false, false],
		['royale', royaleMode, 'everyone', true, false, false, false],
		['nemesis', nemesisMode, 'everyone', true, false, false, false],
		['manhunt', manhuntMode, 'side', true, false, true, true],
		['teams', teamsMode, 'side', true, true, false, false],
	] as const)(
		'%s',
		(_name, mode, deathPolicy, outOfHandsOnFail, pool, sideDeath, voucher) => {
			expect(mode.deathPolicy).toBe(deathPolicy)
			expect(mode.outOfHandsOnFail).toBe(outOfHandsOnFail)
			expect(mode.lifePool !== undefined).toBe(pool)
			expect(mode.opensSideDeath !== undefined).toBe(sideDeath)
			expect(mode.mayRedeemVoucher !== undefined).toBe(voucher)
		},
	)
})

describe('the stubs', () => {
	it.each([duelMode, royaleMode, nemesisMode, manhuntMode, teamsMode])(
		'$name is inert',
		(rules) => {
			const state = emptyPvp()
			const ctx = testContext(0)
			expect(
				rules.init(state, ctx, { startedIds: [], picks: {}, teamPlan: null }),
			).toBe(state)
			for (const hook of [
				rules.roundReady,
				rules.resolveRound,
				rules.checkWinner,
				rules.onForfeit,
			])
				expect(hook(state, ctx)).toBe(state)
		},
	)
})
