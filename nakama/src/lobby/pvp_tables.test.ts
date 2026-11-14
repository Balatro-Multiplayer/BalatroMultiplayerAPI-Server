// The PvP match keys and request types are static tables: a module that imports
// only match_state or requests (not match.ts) still sees all of them. This file
// imports no other lobby module that would register them, on purpose.
import { describe, expect, it } from 'vitest'
import { testContext } from '../testing/request_context'
import { matchKeys } from './match_state'
import { PVP_REQUESTS } from './pvp/register'
import { handleRequest } from './requests'
import { join, newLobby } from './state'

describe('the static PvP tables', () => {
	it('lists the fourteen pvp.* match keys', () => {
		expect([...matchKeys()].sort()).toEqual([
			'pvp.clocks',
			'pvp.effects',
			'pvp.lives',
			'pvp.nemesis',
			'pvp.opponent',
			'pvp.ready',
			'pvp.result',
			'pvp.round',
			'pvp.rules',
			'pvp.skips',
			'pvp.targets',
			'pvp.teams',
			'pvp.traps',
			'pvp.votes',
		])
	})

	it('lists every PvP request type', () => {
		expect(Object.keys(PVP_REQUESTS).sort()).toEqual([
			'pvp.animating',
			'pvp.blind',
			'pvp.blind_start',
			'pvp.effect',
			'pvp.forfeit',
			'pvp.hand',
			'pvp.hand_commit',
			'pvp.progress',
			'pvp.ready',
			'pvp.sell',
			'pvp.shop',
			'pvp.skip',
			'pvp.team',
			'pvp.timer_pause',
			'pvp.timer_spend',
			'pvp.timer_start',
			'pvp.trap_fire',
			'pvp.trap_lost',
			'pvp.trap_plant',
			'pvp.unready',
			'pvp.vote',
			'pvp.voucher',
		])
	})

	it('answers a PvP request type as known, not as unknown_type', () => {
		const lobby = join(
			newLobby({
				code: 'ABCD',
				modId: 'M',
				maxPlayers: 8,
				creatorId: 'u1',
				now: 0,
				graceMs: 60_000,
			}),
			'u1',
			'u1-s',
			{ displayName: 'u1', preferredJoker: null, mods: null },
			0,
		).lobby
		const result = handleRequest(
			lobby,
			'u1',
			{ v: 1, reqId: 'c1:1', type: 'pvp.hand', payload: {} },
			testContext(0),
		)
		expect(result.answer).toEqual({
			reqId: 'c1:1',
			ok: false,
			reason: 'not_running',
		})
	})
})
