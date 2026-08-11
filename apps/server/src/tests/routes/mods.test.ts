import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

// Mirrors runs.test.ts's drizzle chain-mocking pattern -- mods.gateway.ts
// isn't otherwise injectable at the route layer, it's called directly.
function mockSelectOrderByChain(rows: unknown[]) {
	return vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			orderBy: vi.fn().mockResolvedValue(rows),
		}),
	})
}

function mockSelectWhereChain(rows: unknown[]) {
	return vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(rows),
		}),
	})
}

describe('mods routes', () => {
	describe('GET /api/mods', () => {
		it('returns the compact public list, no auth required', async () => {
			const rows = [
				{
					id: 'Author@Mod',
					name: 'Mod',
					allowedInRanked: true,
					rankedVersion: '1.2.3',
					latestVersion: '1.3.0',
					thumbnailUrl: null,
					isCustom: false,
				},
			]
			;(db as any).select = mockSelectOrderByChain(rows)

			const res = await request(app).get('/api/mods')

			expect(res.status).toBe(200)
			expect(res.body).toEqual(rows)
		})
	})

	describe('GET /api/mods/:id', () => {
		it('returns 404 when the mod does not exist', async () => {
			;(db as any).query = {
				...(db as any).query,
				modRegistry: { findFirst: vi.fn().mockResolvedValue(undefined) },
			}

			const res = await request(app).get('/api/mods/Nobody@Nothing')

			expect(res.status).toBe(404)
		})

		it('returns the full record including versions when found', async () => {
			const mod = {
				id: 'Author@Mod',
				title: 'Mod',
				author: 'Author',
				allowedInRanked: true,
				rankedVersion: null,
				latestVersion: '1.0.0',
				latestSha256: 'deadbeef',
				isCustom: false,
			}
			;(db as any).query = {
				...(db as any).query,
				modRegistry: { findFirst: vi.fn().mockResolvedValue(mod) },
			}
			const versions = [
				{
					version: '1.0.0',
					sha256: 'deadbeef',
					downloadUrl: 'https://example.com/mod.zip',
				},
			]
			;(db as any).select = mockSelectWhereChain(versions)

			const res = await request(app).get('/api/mods/Author@Mod')

			expect(res.status).toBe(200)
			expect(res.body).toMatchObject({
				id: 'Author@Mod',
				latestSha256: 'deadbeef',
			})
			expect(res.body.versions).toEqual(versions)
		})
	})
})
