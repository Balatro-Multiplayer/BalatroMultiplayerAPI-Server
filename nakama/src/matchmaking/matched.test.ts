import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { writeModReport } from '../standing/storage'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { matchmakerMatched, planMatch, type MatchedEntry } from './matched'
import { afterMatchmakerAdd, QUEUE_COLLECTION, recordKey } from './queue'

function entry(userId: string, props: { [k: string]: string | number }, partyId?: string): MatchedEntry {
	return { presence: { userId }, properties: props, partyId }
}
const RANKED = { modId: 'MultiplayerPvP', mode: 'pvp_ranked_balanced', kind: 'ranked' }

describe('planMatch', () => {
	it('plans a ranked lobby on the queued mode', () => {
		expect(planMatch([entry('a', RANKED), entry('b', RANKED)])).toEqual({
			modId: 'MultiplayerPvP',
			rankedMode: 'pvp_ranked_balanced',
			gameMode: 'ranked:pvp_ranked_balanced',
			playerIds: ['a', 'b'],
			groups: [],
			teamPlan: null,
			requiredStanding: 'valid',
		})
		expect(planMatch([entry('a', RANKED), entry('b', RANKED)], true)).toMatchObject({ requiredStanding: 'verified' })
	})
	it('refuses a ranked PvP queue the server has no rules for', () => {
		const unknown = { ...RANKED, mode: 'pvp_ranked_chaos' }
		expect(planMatch([entry('a', unknown), entry('b', unknown)])).toMatch(/^unknown_ranked_mode/)
		const other = { modId: 'MultiplayerSPDRN', mode: 'duel', kind: 'ranked' }
		expect(typeof planMatch([entry('a', other), entry('b', other)])).not.toBe('string')
	})
	it('plans a casual lobby with no rating board', () => {
		const casual = { modId: 'MultiplayerSPDRN', mode: 'standard', kind: 'casual' }
		const plan = planMatch([entry('a', casual), entry('b', casual), entry('c', casual)])
		expect(plan).toMatchObject({ rankedMode: '', gameMode: 'standard', playerIds: ['a', 'b', 'c'] })
		// A casual game asks for valid whether or not ranked needs the launcher.
		expect(planMatch([entry('a', casual), entry('b', casual)], true)).toMatchObject({ requiredStanding: 'valid' })
	})
	it('refuses a group that queued for different things', () => {
		const other = { ...RANKED, kind: 'casual' }
		expect(typeof planMatch([entry('a', RANKED), entry('b', other)])).toBe('string')
		expect(typeof planMatch([entry('a', RANKED), entry('b', { ...RANKED, mode: 'x' })])).toBe('string')
	})
	it('refuses a group of tickets from different mods on the same mode', () => {
		const spdrn = { ...RANKED, modId: 'MultiplayerSPDRN' }
		expect(typeof planMatch([entry('a', RANKED), entry('b', spdrn)])).toBe('string')
		const casual = { modId: 'MultiplayerSPDRN', mode: 'standard', kind: 'casual' }
		expect(typeof planMatch([entry('a', casual), entry('b', { ...casual, modId: 'MultiplayerPvP' })])).toBe('string')
	})
	it('refuses one player, a repeated player, and bad names', () => {
		expect(typeof planMatch([entry('a', RANKED)])).toBe('string')
		expect(typeof planMatch([entry('a', RANKED), entry('a', RANKED)])).toBe('string')
		const bad = { ...RANKED, mode: 'no spaces allowed' }
		expect(typeof planMatch([entry('a', bad), entry('b', bad)])).toBe('string')
	})
})

describe('planMatch with groups', () => {
	const CASUAL = { modId: 'MultiplayerSPDRN', mode: 'standard', kind: 'casual' }
	const member = (id: string, size = 2, party = 'p1') => entry(id, { ...CASUAL, groupSize: size }, party)

	it('plans a party with a solo player, the party as one group', () => {
		const plan = planMatch([member('a'), entry('s', CASUAL), member('b')])
		expect(plan).toMatchObject({ playerIds: ['a', 's', 'b'], groups: [{ partyId: 'p1', memberIds: ['a', 'b'] }], teamPlan: null })
	})

	it('refuses group sizes that do not add up', () => {
		expect(planMatch([member('a', 3), member('b', 3), entry('s', CASUAL)])).toMatch(/group size/)
		expect(planMatch([member('a'), entry('s', { ...CASUAL, groupSize: 2 })])).toMatch(/solo/)
		expect(planMatch([member('a'), member('b'), entry('s', CASUAL)].map((e) => ({ ...e, properties: { ...e.properties, kind: 'ranked' } })))).toMatch(/ranked/)
	})

	it('splits a Teams game keeping each group whole', () => {
		const T = { ...CASUAL, teams: 1 }
		const plan = planMatch([
			entry('a', { ...T, groupSize: 2 }, 'p1'),
			entry('s1', T),
			entry('b', { ...T, groupSize: 2 }, 'p1'),
			entry('s2', T),
		])
		expect(plan).toMatchObject({ teamPlan: [['a', 'b'], ['s1', 's2']] })
		expect(planMatch([entry('a', T), entry('b', CASUAL)])).toMatch(/Teams/)
		const three = (id: string) => entry(id, { ...T, groupSize: 3 }, 'p2')
		expect(planMatch([three('t'), three('u'), three('v'), entry('s', T)])).toMatch(/split/)
	})
})

describe('matchmakerMatched', () => {
	it('drops the queue records of a group it refuses', () => {
		const nk = fakeNk()
		const add = { matchmakerAdd: { stringProperties: RANKED } }
		afterMatchmakerAdd(playerCtx('a'), fakeLogger, nk as any, { matchmakerTicket: { ticket: 'ta' } } as any, add as any)
		afterMatchmakerAdd(playerCtx('b'), fakeLogger, nk as any, { matchmakerTicket: { ticket: 'tb' } } as any, add as any)
		const key = recordKey(RANKED.modId, 'ranked:' + RANKED.mode)
		const records = () =>
			nk.storageRead(['a', 'b'].map((userId) => ({ collection: QUEUE_COLLECTION, key, userId })))
		expect(records()).toHaveLength(2)
		writeConfig(nk as any, { ...DEFAULT_CONFIG, rankedEnabled: false })
		expect(() =>
			matchmakerMatched(playerCtx('a'), fakeLogger, nk as any, [entry('a', RANKED), entry('b', RANKED)]),
		).toThrow(/may not queue/)
		expect(records()).toHaveLength(0)
	})

	describe('PvP versions', () => {
		const CASUAL_PVP = { modId: 'MultiplayerPvP', mode: 'pvp_standard', kind: 'casual' }
		function report(nk: ReturnType<typeof fakeNk>, userId: string, pvp: string | null, spdrn?: string) {
			const mods = ['Steamodded-1.0.0~BETA-1814a']
			if (pvp) mods.push('MultiplayerPvP-' + pvp)
			if (spdrn) mods.push('MultiplayerSPDRN-' + spdrn)
			writeModReport(nk as any, userId, { mods, reportedAt: 0 })
		}
		const match = (nk: ReturnType<typeof fakeNk>, props: { [k: string]: string | number }, ...ids: string[]) =>
			matchmakerMatched(playerCtx(ids[0]), fakeLogger, nk as any, ids.map((id) => entry(id, props)))

		it('refuses the player off the common PvP version and tells everyone', () => {
			const nk = fakeNk()
			report(nk, 'a', '1.0.3')
			report(nk, 'b', '1.0.3')
			report(nk, 'c', '1.0.2')
			expect(() => match(nk, CASUAL_PVP, 'a', 'b', 'c')).toThrow(/may not queue/)
			const sent = (id: string) => nk.notifications.filter((n) => n.userId === id)
			expect(sent('c')[0].content).toMatchObject({ code: 'version_mismatch', requeue: false })
			expect(sent('c')[0].content.reason).toMatch(/same MultiplayerPvP version/)
			expect(sent('a')[0].content).toMatchObject({ requeue: true })
			expect(sent('b')[0].content).toMatchObject({ requeue: true })
		})

		it('compares the X.Y.Z prefix only', () => {
			const nk = fakeNk()
			;(nk as any).matchCreate = () => 'match-id'
			report(nk, 'a', '1.0.3')
			report(nk, 'b', '1.0.3-beta.1')
			expect(typeof match(nk, CASUAL_PVP, 'a', 'b')).toBe('string')
		})

		it('does not compare versions of another mod', () => {
			const nk = fakeNk()
			;(nk as any).matchCreate = () => 'match-id'
			const props = { modId: 'MultiplayerSPDRN', mode: 'standard', kind: 'casual' }
			report(nk, 'a', '1.0.3', '2.0.0')
			report(nk, 'b', '1.0.4', '2.0.0')
			expect(typeof match(nk, props, 'a', 'b')).toBe('string')
		})
	})
})
