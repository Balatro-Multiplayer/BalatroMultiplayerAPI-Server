// The rules for which automatic items exist, and the one-time job that closes
// the open items those rules would not make.
import { describe, expect, it, vi } from 'vitest'
import {
	type ObsoleteFacts,
	closeObsoleteItems,
	obsoleteRuleOf,
	raisesAntiCheatItem,
} from '../../features/service-queue/automatic-rules.js'

describe('raisesAntiCheatItem', () => {
	it('makes no item when every player of the match is flagged', () => {
		expect(raisesAntiCheatItem({ playerCount: 2, flaggedCount: 2 })).toBe(false)
		expect(raisesAntiCheatItem({ playerCount: 4, flaggedCount: 4 })).toBe(false)
	})
	it('makes an item when some players are not flagged', () => {
		expect(raisesAntiCheatItem({ playerCount: 2, flaggedCount: 1 })).toBe(true)
		expect(raisesAntiCheatItem({ playerCount: 4, flaggedCount: 3 })).toBe(true)
	})
	it('makes an item for a game with one player', () => {
		expect(raisesAntiCheatItem({ playerCount: 1, flaggedCount: 1 })).toBe(true)
	})
})

const integrity = (integrityTrigger?: 'ranked' | 'repeated'): ObsoleteFacts => ({
	itemType: 'integrity',
	context: integrityTrigger ? { integrityTrigger } : {},
})
const antiCheat = (over: Partial<Extract<ObsoleteFacts, { itemType: 'anti_cheat' }>> = {}): ObsoleteFacts => ({
	itemType: 'anti_cheat',
	flagReason: 'hash_mismatch',
	runStatus: 'completed',
	runPlayers: 2,
	runFlagged: 1,
	logHasEnd: true,
	...over,
})

describe('obsoleteRuleOf', () => {
	it('keeps an integrity item raised during ranked play and closes a queue-time one', () => {
		expect(obsoleteRuleOf(integrity('ranked'))).toBeNull()
		expect(obsoleteRuleOf(integrity('repeated'))?.rule).toBe('integrity_outside_ranked')
		expect(obsoleteRuleOf(integrity())?.rule).toBe('integrity_outside_ranked')
	})
	it('closes an anti-cheat item of a match whose players are all flagged', () => {
		expect(obsoleteRuleOf(antiCheat({ runFlagged: 2 }))?.rule).toBe('anticheat_every_player_flagged')
		expect(obsoleteRuleOf(antiCheat({ runFlagged: 1 }))).toBeNull()
	})
	it('closes an unverified log of a restarted or abandoned game', () => {
		for (const runStatus of ['terminated', 'abandoned'] as const)
			expect(obsoleteRuleOf(antiCheat({ flagReason: 'unverified_log', runStatus }))?.rule).toBe(
				'unverified_log_game_not_played_out',
			)
	})
	it('closes an unverified log of a player who sent no result', () => {
		expect(obsoleteRuleOf(antiCheat({ flagReason: 'unverified_log', logHasEnd: false }))?.rule).toBe(
			'unverified_log_no_result',
		)
	})
	it('keeps an unverified log of a player who reported, and a hash mismatch of a played game', () => {
		expect(obsoleteRuleOf(antiCheat({ flagReason: 'unverified_log' }))).toBeNull()
		expect(obsoleteRuleOf(antiCheat({ flagReason: 'hash_mismatch', logHasEnd: false, runStatus: 'abandoned' }))).toBeNull()
	})
	it('names the rule in the note', () => {
		expect(obsoleteRuleOf(integrity('repeated'))?.note).toMatch(/^Closed by the system: /)
	})
})

describe('closeObsoleteItems', () => {
	const candidates = [
		{ id: 1, playerId: 'p1', facts: integrity('repeated') },
		{ id: 2, playerId: 'p2', facts: integrity('ranked') },
		{ id: 3, playerId: 'p3', facts: antiCheat({ runFlagged: 2 }) },
	]
	function deps(close = vi.fn(async () => true)) {
		return { listOpen: vi.fn(async () => candidates), close }
	}

	it('closes only the items the rules would not make, with a note that names the rule, and counts them', async () => {
		const d = deps()
		const result = await closeObsoleteItems(d)
		expect(result).toEqual({ closed: 2, kept: 1, skipped: 0, byRule: { integrity_outside_ranked: 1, anticheat_every_player_flagged: 1 } })
		expect(d.close).toHaveBeenCalledTimes(2)
		expect(d.close).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1, playerId: 'p1', rule: 'integrity_outside_ranked', note: expect.stringContaining('integrity_outside_ranked') }),
		)
	})

	it('is safe to run twice: an item already closed is skipped, not counted', async () => {
		const d = deps(vi.fn(async () => false))
		expect(await closeObsoleteItems(d)).toMatchObject({ closed: 0, skipped: 2 })
	})
})
