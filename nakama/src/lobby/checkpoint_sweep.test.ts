import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk } from '../testing/fake_nk'
import { MIRROR_COLLECTION } from '../mirror/outbox'
import { checkpointOf, readCheckpoint, saveCheckpoint } from './checkpoint'
import { sweepCheckpoints } from './checkpoint_sweep'
import { CHECKPOINT_TTL_MS, RATINGS_COLLECTION, RUNS_COLLECTION, SYSTEM_USER_ID, type RunRecord } from './protocol'
import { type Lobby, join, newLobby } from './state'

const info = (name: string) => ({ displayName: name, preferredJoker: null, mods: null })

function lobbyWith(code: string, started: boolean): Lobby {
	let lobby = newLobby({ code, modId: 'M', maxPlayers: 4, creatorId: 'a', now: 0, graceMs: 10_000 })
	lobby = join(lobby, 'a', 'a-s', info('a')).lobby
	lobby = join(lobby, 'b', 'b-s', info('b')).lobby
	if (!started) return lobby
	return {
		...lobby,
		rankedMode: 'ranked_1v1',
		game: {
			...lobby.game,
			started: {
				runId: `run-${code}`,
				seed: 's',
				stake: 1,
				options: null,
				startedAt: 100,
				hostId: 'a',
				players: [
					{ id: 'a', displayName: 'a' },
					{ id: 'b', displayName: 'b' },
				],
			},
		},
	}
}

const stored = (nk: any, collection: string, key: string) =>
	nk.storageRead([{ collection, key, userId: SYSTEM_USER_ID }])

describe('sweepCheckpoints', () => {
	it('deletes an expired checkpoint and keeps a live one', () => {
		const nk: any = fakeNk()
		saveCheckpoint(nk, checkpointOf(lobbyWith('OLD111', false), 0)!)
		saveCheckpoint(nk, checkpointOf(lobbyWith('NEW222', false), CHECKPOINT_TTL_MS)!)
		const result = sweepCheckpoints(nk, fakeLogger, CHECKPOINT_TTL_MS + 1, 100)
		expect(result).toEqual({ deleted: 1, noContest: 0, more: false })
		expect(readCheckpoint(nk, 'OLD111')).toBeNull()
		expect(readCheckpoint(nk, 'NEW222')).not.toBeNull()
	})

	it('keeps a checkpoint a resume claimed a moment ago', () => {
		const nk: any = fakeNk()
		const cp = checkpointOf(lobbyWith('CLM333', false), 0)!
		saveCheckpoint(nk, { ...cp, claimedAt: CHECKPOINT_TTL_MS - 1000 })
		const result = sweepCheckpoints(nk, fakeLogger, CHECKPOINT_TTL_MS + 1, 100)
		expect(result.deleted).toBe(0)
		expect(readCheckpoint(nk, 'CLM333')).not.toBeNull()
	})

	it('records a started game nobody came back to as no contest, with no Elo change', () => {
		const nk: any = fakeNk({ uuidv4: () => 'u1', sha256Hash: (s: string) => `h${s.length}` })
		const warnings: string[] = []
		const logger: any = { ...fakeLogger, warn: (f: string, ...a: unknown[]) => warnings.push(`${f} ${a.join(' ')}`) }
		saveCheckpoint(nk, checkpointOf(lobbyWith('GAME44', true), 0)!)
		const now = CHECKPOINT_TTL_MS + 5
		const result = sweepCheckpoints(nk, logger, now, 100)
		expect(result).toEqual({ deleted: 1, noContest: 1, more: false })
		expect(readCheckpoint(nk, 'GAME44')).toBeNull()

		const run = stored(nk, RUNS_COLLECTION, 'run-GAME44')[0].value as RunRecord
		expect(run.status).toBe('abandoned')
		expect(run.placements).toEqual([])
		expect(run.endedAt).toBe(now)
		expect(run.ratings).toBeUndefined()
		for (const key of nk.objects.keys()) expect(key.startsWith(`${RATINGS_COLLECTION}/`)).toBe(false)
		// The API mirror learns of it, and moderators see a log line.
		expect([...nk.objects.keys()].some((k: string) => k.startsWith(`${MIRROR_COLLECTION}/`))).toBe(true)
		expect(warnings.some((w) => w.includes('no contest') && w.includes('GAME44'))).toBe(true)
	})

	it('stops at the limit and says there is more', () => {
		const nk: any = fakeNk()
		for (const code of ['AAA111', 'BBB222', 'CCC333']) saveCheckpoint(nk, checkpointOf(lobbyWith(code, false), 0)!)
		const first = sweepCheckpoints(nk, fakeLogger, CHECKPOINT_TTL_MS + 1, 2)
		expect(first).toEqual({ deleted: 2, noContest: 0, more: true })
		const second = sweepCheckpoints(nk, fakeLogger, CHECKPOINT_TTL_MS + 1, 2)
		expect(second).toEqual({ deleted: 1, noContest: 0, more: false })
	})
})

describe('sweepCheckpoints with a short ttl', () => {
	it('treats a row older than ttlMs as expired, whatever its own expiry says', () => {
		const nk: any = fakeNk()
		saveCheckpoint(nk, checkpointOf(lobbyWith('SHORT5', false), 1000)!)
		expect(sweepCheckpoints(nk, fakeLogger, 1500, 100, 1000).deleted).toBe(0)
		expect(sweepCheckpoints(nk, fakeLogger, 2000, 100, 1000).deleted).toBe(1)
	})
})

describe('sweepCheckpoints with Run saves', () => {
	it('leaves no Run save behind', () => {
		const nk: any = fakeNk({ uuidv4: () => 'u1', sha256Hash: (s: string) => `h${s.length}` })
		const lobby = lobbyWith('SAV555', true)
		const withSaves: Lobby = {
			...lobby,
			game: {
				...lobby.game,
				runSaves: { a: { id: 's1', pos: 2, hash: 'a'.repeat(64), data: 'RUNSAVE-DATA-MARKER', at: 1 } },
			},
		}
		saveCheckpoint(nk, checkpointOf(withSaves, 0)!)
		sweepCheckpoints(nk, fakeLogger, CHECKPOINT_TTL_MS + 5, 100)
		for (const o of nk.objects.values()) expect(JSON.stringify(o)).not.toContain('RUNSAVE-DATA-MARKER')
	})
})
