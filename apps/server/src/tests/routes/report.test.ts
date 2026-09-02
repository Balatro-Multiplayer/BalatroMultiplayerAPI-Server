import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../features/auth/jwt.js'
import { createSession } from '../../state/index.js'
import { getLobby } from '../../state/index.js'
import { db } from '../../infrastructure/db/index.js'
import { reports } from '../../infrastructure/db/schema.js'
import * as lobbyService from '../../features/lobby/lobby.service.js'

const app = createTestApp()

// Every db.insert().values() chain resolves this shape -- a bare-awaitable
// Promise that ALSO exposes .returning() (submitReport's own insert) and
// .onConflictDoNothing() -> another such promise (service-queue.gateway.ts's
// enqueueServiceQueueItem, now called at the end of every submitReport()).
function chainableInsertValues(): any {
	const p: any = Promise.resolve(undefined)
	p.returning = vi.fn().mockResolvedValue([{ id: 1 }])
	p.onConflictDoNothing = vi.fn().mockReturnValue(p)
	return p
}

// submitReport() now does a db.select (getMostRecentRunForLobbyCode) before its
// db.insert(...).returning(...) -- the base mock in tests/setup.ts has no
// .select stub at all and its .insert().values() resolves bare (no
// .returning()), so both need a per-suite default here. Mirrors the dual
// awaitable-and-chainable trick runs.test.ts uses for insertRun's .returning().
function installReportDbMocks(runRows: unknown[] = []) {
	;(db as any).select = vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				orderBy: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue(runRows),
				}),
			}),
		}),
	})
	;(db as any).insert = vi.fn().mockReturnValue({
		values: vi.fn().mockImplementation(() => chainableInsertValues()),
	})
}

beforeEach(() => {
	installReportDbMocks()
})

function authHeader(
	playerId: string,
	steamName: string,
	lobbyCode?: string,
	opts?: { chatEnabled?: boolean },
) {
	createSession(steamName, { id: playerId, chatEnabled: opts?.chatEnabled ?? false })
	const token = signJwt({ playerId, steamName, lobbyCode })
	return `Bearer ${token}`
}

async function createLobby(hostId: string, hostName: string) {
	const res = await request(app)
		.post('/api/lobbies')
		.set('Authorization', authHeader(hostId, hostName))
		.send({ modId: 'mod1' })
	return res.body.lobby.code as string
}

describe('POST /api/lobbies/:code/report', () => {
	it('returns 401 without auth', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })
		expect(res.status).toBe(401)
	})

	it('returns 404 for unknown lobby code', async () => {
		const res = await request(app)
			.post('/api/lobbies/ZZZZZ/report')
			.set('Authorization', authHeader('p1', 'Alice'))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })
		expect(res.status).toBe(404)
	})

	it('returns 403 if reporter is not in the lobby', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('outsider', 'Eve'))
			.send({ reportedPlayerId: 'host1', type: 'cheating' })
		expect(res.status).toBe(403)
	})

	it('returns 400 if reportedPlayerId is missing', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ type: 'cheating' })
		expect(res.status).toBe(400)
	})

	it('returns 400 if type is missing', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 if type is not in the fixed taxonomy', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'harassment' })
		expect(res.status).toBe(400)
	})

	it('returns 400 if message exceeds 500 characters', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating', message: 'x'.repeat(501) })
		expect(res.status).toBe(400)
	})

	it('accepts a report without an optional message', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })
		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)
	})

	it('accepts a report with an optional message', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating', message: 'They were being rude' })
		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)
	})

	it('marks the lobby as reported after first report', async () => {
		const code = await createLobby('host1', 'Alice')
		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })

		const lobby = getLobby(code)
		expect(lobby?.isReported).toBe(true)
	})

	it('allows reporting a player who has already left the lobby', async () => {
		const code = await createLobby('host1', 'Alice')
		// guest1 is just a player ID — they don't need to be in the lobby currently
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'former-player-id', type: 'cheating' })
		expect(res.status).toBe(200)
	})

	it('flushes message buffer to DB on first report', async () => {
		const { db } = await import('../../infrastructure/db/index.js')
		const code = await createLobby('host1', 'Alice')

		// Manually populate the buffer
		const lobby = getLobby(code)!
		lobby.bufferMessage({ playerId: 'host1', displayName: 'Alice', message: 'hello', sentAt: new Date() })
		lobby.bufferMessage({ playerId: 'guest1', displayName: 'Bob', message: 'hi', sentAt: new Date() })

		vi.mocked(db.insert).mockClear()

		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })

		// Should have called insert 3 times: the report, the buffer flush, and
		// the service-queue index row (enqueueServiceQueueItem).
		expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(3)
	})

	it('does not flush buffer again on subsequent reports', async () => {
		const { db } = await import('../../infrastructure/db/index.js')
		const code = await createLobby('host1', 'Alice')

		const lobby = getLobby(code)!
		lobby.bufferMessage({ playerId: 'host1', displayName: 'Alice', message: 'hello', sentAt: new Date() })

		// First report — marks lobby + flushes buffer
		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })

		vi.mocked(db.insert).mockClear()

		// Second report — only inserts the report row
		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest2', type: 'cheating' })

		// The report insert + the service-queue index row -- no buffer flush
		// since the lobby was already marked reported by the first report.
		expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(2)
	})

	it('resolves and stores runId from the most recent lobbyRuns row for the lobby code', async () => {
		installReportDbMocks([{ id: 'run-42' }])
		let insertedValues: any = null
		;(db as any).insert = vi.fn().mockImplementation((table: unknown) => ({
			values: vi.fn().mockImplementation((values: any) => {
				if (table === reports) insertedValues = values
				return chainableInsertValues()
			}),
		}))

		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })

		expect(res.status).toBe(200)
		expect(insertedValues.runId).toBe('run-42')
	})

	it('stores runId as null when no run exists for the lobby code', async () => {
		installReportDbMocks([]) // no lobbyRuns row for this code
		let insertedValues: any = null
		;(db as any).insert = vi.fn().mockImplementation((table: unknown) => ({
			values: vi.fn().mockImplementation((values: any) => {
				if (table === reports) insertedValues = values
				return chainableInsertValues()
			}),
		}))

		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })

		expect(res.status).toBe(200)
		expect(insertedValues.runId).toBeNull()
	})
})
