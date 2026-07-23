import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as muteGateway from '../../infrastructure/gateways/mute.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

describe('POST /api/mutes/:targetId', () => {
	it('returns 401 when Authorization header is missing', async () => {
		const res = await request(app).post('/api/mutes/some-target')
		expect(res.status).toBe(401)
	})

	it('mutes a target and reflects it in mutedPlayerIds', async () => {
		createSession('Alice', { id: 'mute-p1' })
		const token = signJwt({ playerId: 'mute-p1', steamName: 'Alice' })

		const res = await request(app)
			.post('/api/mutes/target-1')
			.set('Authorization', `Bearer ${token}`)

		expect(res.status).toBe(200)
		expect(res.body.mutedPlayerIds).toEqual(['target-1'])
		expect(vi.mocked(muteGateway.addMute)).toHaveBeenCalledWith('mute-p1', 'target-1')
	})

	it('rejects muting yourself', async () => {
		createSession('Alice', { id: 'mute-p2' })
		const token = signJwt({ playerId: 'mute-p2', steamName: 'Alice' })

		const res = await request(app)
			.post('/api/mutes/mute-p2')
			.set('Authorization', `Bearer ${token}`)

		expect(res.status).toBe(400)
		expect(vi.mocked(muteGateway.addMute)).not.toHaveBeenCalled()
	})

	it('muting an already-muted player is idempotent', async () => {
		createSession('Alice', { id: 'mute-p3', mutedPlayerIds: ['target-1'] })
		const token = signJwt({ playerId: 'mute-p3', steamName: 'Alice' })

		const res = await request(app)
			.post('/api/mutes/target-1')
			.set('Authorization', `Bearer ${token}`)

		expect(res.status).toBe(200)
		expect(res.body.mutedPlayerIds).toEqual(['target-1'])
	})
})

describe('DELETE /api/mutes/:targetId', () => {
	it('returns 401 when Authorization header is missing', async () => {
		const res = await request(app).delete('/api/mutes/some-target')
		expect(res.status).toBe(401)
	})

	it('unmutes a previously-muted target', async () => {
		createSession('Alice', { id: 'unmute-p1', mutedPlayerIds: ['target-1', 'target-2'] })
		const token = signJwt({ playerId: 'unmute-p1', steamName: 'Alice' })

		const res = await request(app)
			.delete('/api/mutes/target-1')
			.set('Authorization', `Bearer ${token}`)

		expect(res.status).toBe(200)
		expect(res.body.mutedPlayerIds).toEqual(['target-2'])
		expect(vi.mocked(muteGateway.removeMute)).toHaveBeenCalledWith('unmute-p1', 'target-1')
	})

	it('unmuting a non-muted player is a no-op', async () => {
		createSession('Alice', { id: 'unmute-p2', mutedPlayerIds: [] })
		const token = signJwt({ playerId: 'unmute-p2', steamName: 'Alice' })

		const res = await request(app)
			.delete('/api/mutes/never-muted')
			.set('Authorization', `Bearer ${token}`)

		expect(res.status).toBe(200)
		expect(res.body.mutedPlayerIds).toEqual([])
	})
})
