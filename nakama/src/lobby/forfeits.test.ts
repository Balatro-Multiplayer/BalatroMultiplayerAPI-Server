import { describe, expect, it } from 'vitest'
import { rpcAdminMirrorPull } from '../admin'
import { PVP_MOD_ID } from '../standing/pvp_version'
import { fakeLogger, fakeNk, serverCtx } from '../testing/fake_nk'
import { withRules } from '../testing/pvp_rules'
import { testContext } from '../testing/request_context'
import { FORFEITS_COLLECTION, RECONCILIATION_WINDOW_MS, noteReturn, recordForfeit } from './forfeits'
import { frozenState } from './pvp/freeze_env'
import { pvpTick } from './pvp/referee'
import { type RefereeState, refereeOf, withReferee } from './pvp/state'
import { type Lobby, disconnect, join, newLobby, tick } from './state'

const info = (name: string) => ({ displayName: name, preferredJoker: null, mods: null })

function startedLobby(gameMode?: string, ids: string[] = ['a', 'b']): Lobby {
	let lobby = newLobby({ code: 'ABCDE', modId: 'M', maxPlayers: ids.length, creatorId: 'a', now: 0, graceMs: 10_000, gameMode })
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id)).lobby
	const players = ids.map((id) => ({ id, displayName: id }))
	return { ...lobby, game: { ...lobby.game, started: { runId: 'r1', hostId: 'a', players } as never } }
}

function rankedPvpLobby(ids: string[] = ['a', 'b']): Lobby {
	const lobby = startedLobby('duel', ids)
	return { ...lobby, modId: PVP_MOD_ID, rankedMode: 'duel' }
}

function frozen(lobby: Lobby): Lobby {
	const withMeta = { ...lobby, metadata: withRules({ ruleset: 'ruleset_mp_balanced' }) }
	const result = frozenState(withMeta, refereeOf(withMeta) as RefereeState, testContext(0))
	if (!result.ok) throw new Error(`rules did not freeze: ${result.key}`)
	return withReferee(withMeta, result.state)
}

function raced(lobby: Lobby): Lobby {
	const started = { ...(lobby.game.started as object), raceStartedAt: 1 } as never
	return { ...lobby, game: { ...lobby.game, started } }
}

function contested(lobby: Lobby): Lobby {
	return { ...lobby, game: { ...lobby.game, contest: { by: 'a', against: 'b', at: 5 } } }
}

describe('timing out of a game', () => {
	it('is recorded for matchmade and private games alike', () => {
		for (const gameMode of ['duel', undefined]) {
			const away = disconnect(startedLobby(gameMode), 'b', 'b-s', 0).lobby
			const out = tick(away, 10_000).out.filter((o) => o.kind === 'forfeited')
			expect(out).toEqual([
				{ kind: 'forfeited', userId: 'b', runId: 'r1', code: 'ABCDE', at: 10_000, lobbyKind: gameMode ? 'casual' : 'private' },
			])
		}
	})

	it.each([
		['a ranked PvP game of two before the rules freeze', (l: Lobby) => l, 'dodged'],
		['a ranked PvP game whose rules a request froze before the race', frozen, 'dodged'],
		['a ranked game of another mod', (l: Lobby) => ({ ...l, modId: 'OtherMod' }), 'forfeited'],
		['a ranked PvP game of two contested before the race', contested, 'forfeited'],
		['a casual PvP game of two', (l: Lobby) => ({ ...l, rankedMode: undefined }), 'forfeited'],
	] as const)('records exactly one of forfeit or dodge for %s', (_name, shape, expected) => {
		const lobby = shape(rankedPvpLobby())
		const away = disconnect(lobby, 'b', 'b-s', 0).lobby
		const expired = tick(away, 10_000)
		const refereed = pvpTick(expired.lobby, testContext(10_000))
		const records = [...expired.out, ...refereed.out].filter((o) => o.kind === 'forfeited' || o.kind === 'dodged')
		expect(records.map((o) => o.kind)).toEqual([expected])
	})

	it('a ranked PvP game whose seat was away when the race began is a dodge at the next tick', () => {
		const away = disconnect(raced(rankedPvpLobby()), 'b', 'b-s', 0).lobby
		const refereed = pvpTick(away, testContext(500))
		const records = refereed.out.filter((o) => o.kind === 'forfeited' || o.kind === 'dodged')
		expect(records).toEqual([expect.objectContaining({ kind: 'dodged', leaverId: 'b', runId: 'r1' })])
		expect(refereed.lobby.game.started).toBeNull()
	})

	it('a ranked PvP game once the race began: a seat away since before it, whose grace ran out at the same tick, is one dodge', () => {
		const away = disconnect(raced(rankedPvpLobby()), 'b', 'b-s', 0).lobby
		const expired = tick(away, 10_000)
		const refereed = pvpTick(expired.lobby, testContext(10_000))
		const records = [...expired.out, ...refereed.out].filter((o) => o.kind === 'forfeited' || o.kind === 'dodged')
		expect(records.map((o) => o.kind)).toEqual(['dodged'])
	})

	it('a ranked PvP game whose seat dropped after the race began is a forfeit, not a dodge', () => {
		const lobby = raced(rankedPvpLobby())
		const away = disconnect(lobby, 'b', 'b-s', 5).lobby
		const expired = tick(away, 10_005)
		const refereed = pvpTick(expired.lobby, testContext(10_005))
		const records = [...expired.out, ...refereed.out].filter((o) => o.kind === 'forfeited' || o.kind === 'dodged')
		expect(records.map((o) => o.kind)).toEqual(['forfeited'])
	})

	describe('a disconnect through the Draft is a dodge', () => {
		const openDraft = { kind: 'draft', id: 'd1', pool: [], banned: [], schedule: [], turn: 0, turnMs: 30_000, deadline: 99_999, remaining: 1, first: 0, order: ['a', 'b'] } as never
		const withSetup = (lobby: Lobby, open: unknown): Lobby => ({
			...lobby,
			game: { ...lobby.game, setup: { open, results: open === null ? { d1: { kind: 'draft', survivors: [], banned: [] } } : {} } } as never,
		})
		const records = (out: { kind: string }[]) => out.filter((o) => o.kind === 'forfeited' || o.kind === 'dodged')
		const racedAt = (lobby: Lobby, at: number): Lobby => ({
			...lobby,
			game: { ...lobby.game, started: { ...(lobby.game.started as object), raceStartedAt: at } as never },
		})

		it('away while the Draft runs: nothing is decided until the race starts, then a dodge by that seat', () => {
			const away = disconnect(withSetup(rankedPvpLobby(), openDraft), 'b', 'b-s', 100).lobby
			expect(records(pvpTick(away, testContext(500)).out)).toEqual([])
			const done = pvpTick(racedAt(withSetup(away, null), 550), testContext(600))
			expect(records(done.out)).toEqual([expect.objectContaining({ kind: 'dodged', leaverId: 'b', runId: 'r1' })])
			expect(done.lobby.game.started).toBeNull()
		})

		it('a Draft finished with no race start yet is not a dodge on its own', () => {
			const away = disconnect(withSetup(rankedPvpLobby(), null), 'b', 'b-s', 100).lobby
			expect(records(pvpTick(away, testContext(600)).out)).toEqual([])
		})

		it('away and back before the race starts: no dodge', () => {
			const away = disconnect(withSetup(frozen(rankedPvpLobby()), openDraft), 'b', 'b-s', 100).lobby
			const back = join(away, 'b', 'b-s2', info('b'), 200).lobby
			const done = pvpTick(racedAt(withSetup(back, null), 550), testContext(600))
			expect(records(done.out)).toEqual([])
			expect(done.lobby.game.started).not.toBeNull()
		})

		it('both away when the race starts: a dodge for each', () => {
			let both = racedAt(withSetup(rankedPvpLobby(), null), 550)
			for (const id of ['a', 'b']) both = disconnect(both, id, `${id}-s`, 100).lobby
			const done = pvpTick(both, testContext(600))
			expect(records(done.out).map((o) => (o as unknown as { leaverId: string }).leaverId).sort()).toEqual(['a', 'b'])
			expect(records(done.out).map((o) => o.kind)).toEqual(['dodged', 'dodged'])
		})

		it('a casual game is never a dodge by this rule', () => {
			const casual = { ...racedAt(withSetup(rankedPvpLobby(), null), 550), rankedMode: undefined }
			const away = disconnect(casual, 'b', 'b-s', 100).lobby
			expect(records(pvpTick(away, testContext(600)).out)).toEqual([])
		})

		it('a seat that drops across a seed-vote restart is a forfeit: the dodge window is the first run only', () => {
			const lobby = racedAt(rankedPvpLobby(), 1)
			const restarted = {
				...lobby,
				game: { ...lobby.game, started: { ...(lobby.game.started as object), runId: 'r2', raceStartedAt: undefined, restarted: true } as never },
			}
			const away = disconnect(restarted, 'b', 'b-s', 100).lobby
			const expired = tick(away, 10_100)
			const refereed = pvpTick(expired.lobby, testContext(10_100))
			expect(records([...expired.out, ...refereed.out]).map((o) => o.kind)).toEqual(['forfeited'])
		})
	})

	it.each([
		['a ranked PvP game of two where both time out on the same tick', ['a', 'b'], ['dodged', 'dodged']],
		['a ranked PvP game of three where everyone times out before the freeze', ['a', 'b', 'c'], ['forfeited', 'forfeited', 'forfeited']],
	] as const)('records exactly one record per leaver for %s', (_name, ids, expected) => {
		let lobby = rankedPvpLobby([...ids])
		for (const id of ids) lobby = disconnect(lobby, id, `${id}-s`, 0).lobby
		const expired = tick(lobby, 10_000)
		const refereed = pvpTick(expired.lobby, testContext(10_000))
		const records = [...expired.out, ...refereed.out].filter((o) => o.kind === 'forfeited' || o.kind === 'dodged')
		expect(records.map((o) => o.kind)).toEqual(expected)
		expect(records.map((o) => (o.kind === 'forfeited' ? o.userId : o.leaverId)).sort()).toEqual([...ids])
	})

	it('is filed for review when the player is back in time, then forgotten', () => {
		const nk: any = fakeNk({ uuidv4: () => 'u1', accountGetId: () => ({ customId: '' }) })
		recordForfeit(nk, 'b', { runId: 'r1', code: 'ABCDE', at: 1000 })
		recordForfeit(nk, 'b', { runId: 'r0', code: 'OLDER', at: 1000 - RECONCILIATION_WINDOW_MS })
		noteReturn(nk, fakeLogger, 'b', 1000 + RECONCILIATION_WINDOW_MS - 1)
		const { entries } = JSON.parse(rpcAdminMirrorPull(serverCtx(), fakeLogger, nk, '{}'))
		expect(entries).toEqual([
			expect.objectContaining({ kind: 'forfeit', userId: 'b', runId: 'r1', code: 'ABCDE', forfeitedAt: 1000 }),
		])
		expect([...nk.objects.keys()].some((k: string) => k.startsWith(FORFEITS_COLLECTION))).toBe(false)
	})
})
