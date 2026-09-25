import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

// mods.gateway.ts isn't injectable at the route layer, so db.select is mocked
// with a chain whose every builder method returns itself and which resolves
// to `rows` when awaited -- covers select().from().where().orderBy() and any
// shorter chain alike.
function chain(rows: unknown[]) {
	const c: Record<string, unknown> = {}
	for (const m of ['from', 'where', 'orderBy']) c[m] = vi.fn(() => c)
	c.then = (
		resolve: (v: unknown) => unknown,
		reject: (e: unknown) => unknown,
	) => Promise.resolve(rows).then(resolve, reject)
	return c
}

function mockSelects(...results: unknown[][]) {
	const select = vi.fn()
	for (const rows of results) select.mockReturnValueOnce(chain(rows))
	;(db as any).select = select
}

// Exactly the keys (and JSON types) new.balatromp.com served before the
// Thunderstore-only switch, captured 2026-09-23. The launcher (BET) reads
// these leniently, so every one must still be present with the same type.
const PROD_LIST_KEYS = {
	id: 'string',
	name: 'string',
	rankedVersion: 'string|null',
	featured: 'boolean',
	hidden: 'boolean',
	latestVersion: 'string|null',
	latestDownloadUrl: 'string|null',
	thumbnailUrl: 'string|null',
	isCustom: 'boolean',
	overriddenFields: 'array',
	searchTerms: 'array',
	sourceType: 'string',
}
const PROD_DETAIL_KEYS = {
	id: 'string',
	title: 'string',
	author: 'string',
	categories: 'array',
	searchTerms: 'array',
	requiresSteamodded: 'boolean',
	requiresTalisman: 'boolean',
	repoUrl: 'string|null',
	thumbnailUrl: 'string|null',
	description: 'string|null',
	latestVersion: 'string|null',
	latestDownloadUrl: 'string|null',
	latestSha256: 'string|null',
	rankedVersion: 'string|null',
	featured: 'boolean',
	hidden: 'boolean',
	isCustom: 'boolean',
	automaticVersionCheck: 'boolean',
	fixedReleaseTagUpdates: 'boolean',
	overriddenFields: 'array',
	indexSource: 'string|null',
	sourceUpdatedAt: 'string|null',
	createdAt: 'string',
	updatedAt: 'string',
	sourceType: 'string',
	versions: 'array',
}
const PROD_VERSION_KEYS = {
	id: 'number',
	modId: 'string',
	version: 'string',
	sha256: 'string|null',
	downloadUrl: 'string|null',
	releasedAt: 'string|null',
	pinFailedAt: 'string|null',
}
const PROD_PROFILE_KEYS = {
	id: 'string',
	name: 'string',
	slug: 'string',
	description: 'string|null',
	createdBy: 'string|null',
	createdAt: 'string',
	updatedAt: 'string',
	entries: 'array',
}
const PROD_PROFILE_ENTRY_KEYS = {
	id: 'number',
	profileId: 'string',
	modId: 'string',
	versionMode: 'string',
	pinnedVersion: 'string|null',
	allowed: 'boolean',
}

function jsonType(v: unknown) {
	if (v === null) return 'null'
	if (Array.isArray(v)) return 'array'
	return typeof v
}

function expectShape(
	obj: Record<string, unknown>,
	keys: Record<string, string>,
) {
	for (const [key, allowed] of Object.entries(keys)) {
		expect(obj, `missing key ${key}`).toHaveProperty(key)
		expect(allowed.split('|'), `type of ${key}`).toContain(jsonType(obj[key]))
	}
}

const now = new Date('2026-09-01T00:00:00Z')

function modRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'MultiplayerAPI',
		thunderstoreFullName: 'BalatroMultiplayer-MultiplayerAPI',
		title: 'Multiplayer API',
		author: 'BalatroMultiplayer',
		categories: ['Mods'],
		requiresSteamodded: true,
		requiresTalisman: false,
		repoUrl: 'https://github.com/Balatro-Multiplayer/BalatroMultiplayerAPI',
		thumbnailUrl: 'https://gcdn.thunderstore.io/icon.png',
		description: 'API',
		packageUrl:
			'https://thunderstore.io/c/balatro/p/BalatroMultiplayer/MultiplayerAPI/',
		donationLink: 'https://ko-fi.com/virtualized',
		latestVersion: '0.1.2',
		latestDownloadUrl:
			'https://thunderstore.io/package/download/BalatroMultiplayer/MultiplayerAPI/0.1.2/',
		rankedVersion: '0.1.2',
		rankedVersionSha256: 'a'.repeat(64),
		featured: true,
		hidden: false,
		isCustom: false,
		automaticVersionCheck: false,
		fixedReleaseTagUpdates: false,
		searchTerms: [] as string[],
		sourceUpdatedAt: now,
		createdAt: now,
		updatedAt: now,
		...overrides,
	}
}

function versionRow(id: number, version: string, releasedAt: string) {
	return {
		id,
		modId: 'MultiplayerAPI',
		version,
		downloadUrl: `https://thunderstore.io/package/download/BalatroMultiplayer/MultiplayerAPI/${version}/`,
		releasedAt: new Date(releasedAt),
		dependencies: ['Steamodded-Steamodded-1.1814.0'],
	}
}

describe('mods routes', () => {
	describe('GET /api/mods', () => {
		it('serves every key the pre-Thunderstore list did, plus the new ones', async () => {
			mockSelects([modRow()])

			const res = await request(app).get('/api/mods')

			expect(res.status).toBe(200)
			expect(res.body).toHaveLength(1)
			expectShape(res.body[0], PROD_LIST_KEYS)
			expect(res.body[0]).toMatchObject({
				id: 'MultiplayerAPI',
				name: 'Multiplayer API',
				title: 'Multiplayer API',
				rankedVersion: '0.1.2',
				rankedVersionSha256: 'a'.repeat(64),
				sourceType: 'release',
				thunderstoreFullName: 'BalatroMultiplayer-MultiplayerAPI',
			})
		})
	})

	describe('custom mods', () => {
		const customRow = () =>
			modRow({
				id: 'PartnerMod',
				thunderstoreFullName: null,
				isCustom: true,
				automaticVersionCheck: true,
				searchTerms: ['partner'],
				latestVersion: 'abc1234',
				latestDownloadUrl: 'https://github.com/o/r/archive/refs/heads/main.zip',
			})

		it('lists a custom mod with its real flags and a url-derived sourceType', async () => {
			mockSelects([customRow()])

			const res = await request(app).get('/api/mods')

			expectShape(res.body[0], PROD_LIST_KEYS)
			expect(res.body[0]).toMatchObject({
				isCustom: true,
				searchTerms: ['partner'],
				sourceType: 'branch',
				thunderstoreFullName: null,
			})
		})

		it('serves a custom mod detail with its version-check flags', async () => {
			mockSelects([customRow()], [])

			const res = await request(app).get('/api/mods/PartnerMod')

			expectShape(res.body, PROD_DETAIL_KEYS)
			expect(res.body).toMatchObject({
				isCustom: true,
				automaticVersionCheck: true,
				indexSource: 'custom',
				sourceType: 'branch',
			})
		})
	})

	describe('GET /api/mods/:id', () => {
		it('returns 404 when the mod does not exist', async () => {
			mockSelects([])

			const res = await request(app).get('/api/mods/Nobody-Nothing')

			expect(res.status).toBe(404)
		})

		it('returns 404 for a hidden mod', async () => {
			mockSelects([modRow({ hidden: true })])

			const res = await request(app).get('/api/mods/MultiplayerAPI')

			expect(res.status).toBe(404)
		})

		it('serves every key the pre-Thunderstore detail did, plus the new ones', async () => {
			mockSelects(
				[modRow()],
				[
					versionRow(1, '0.1.1', '2026-08-01'),
					versionRow(2, '0.1.2', '2026-09-01'),
				],
			)

			const res = await request(app).get('/api/mods/MultiplayerAPI')

			expect(res.status).toBe(200)
			expectShape(res.body, PROD_DETAIL_KEYS)
			for (const v of res.body.versions) expectShape(v, PROD_VERSION_KEYS)
			expect(res.body).toMatchObject({
				thunderstoreFullName: 'BalatroMultiplayer-MultiplayerAPI',
				packageUrl:
					'https://thunderstore.io/c/balatro/p/BalatroMultiplayer/MultiplayerAPI/',
				donationLink: 'https://ko-fi.com/virtualized',
				indexSource: 'thunderstore',
			})
		})

		it('orders versions newest first and hashes only the ranked one', async () => {
			mockSelects(
				[modRow()],
				[
					versionRow(1, '0.1.1', '2026-08-01'),
					versionRow(2, '0.1.2', '2026-09-01'),
				],
			)

			const res = await request(app).get('/api/mods/MultiplayerAPI')

			expect(res.body.versions.map((v: any) => v.version)).toEqual([
				'0.1.2',
				'0.1.1',
			])
			expect(res.body.versions.map((v: any) => v.sha256)).toEqual([
				'a'.repeat(64),
				null,
			])
			expect(res.body.versions[0].dependencies).toEqual([
				'Steamodded-Steamodded-1.1814.0',
			])
			expect(res.body.latestSha256).toBe('a'.repeat(64))
		})

		it('serves no latestSha256 when the latest version is not the ranked one', async () => {
			mockSelects([modRow({ rankedVersion: '0.1.1' })], [])

			const res = await request(app).get('/api/mods/MultiplayerAPI')

			expect(res.body.latestSha256).toBeNull()
		})

		it('resolves a Thunderstore full name to the legacy-id row', async () => {
			mockSelects([modRow()], [])

			const res = await request(app).get(
				'/api/mods/BalatroMultiplayer-MultiplayerAPI',
			)

			expect(res.status).toBe(200)
			expect(res.body.id).toBe('MultiplayerAPI')
		})
	})

	describe('GET /api/mods/profiles', () => {
		const profile = {
			id: 'b4148c13-8c69-4ad2-94aa-73f3a02f2b0a',
			name: 'Multiplayer PvP',
			slug: 'mppvp',
			description: 'PvP preset',
			createdBy: null,
			createdAt: now,
			updatedAt: now,
		}
		const entry = {
			id: 7,
			profileId: profile.id,
			modId: 'smods',
			versionMode: 'exact',
			pinnedVersion: '1.1620.0',
			allowed: true,
		}

		it('lists profiles with their entries, in the pre-Thunderstore shape', async () => {
			mockSelects([profile], [entry])

			const res = await request(app).get('/api/mods/profiles')

			expect(res.status).toBe(200)
			expectShape(res.body[0], PROD_PROFILE_KEYS)
			expectShape(res.body[0].entries[0], PROD_PROFILE_ENTRY_KEYS)
			expect(res.body[0].entries[0].modId).toBe('smods')
		})

		it('is not swallowed by the /:id route', async () => {
			mockSelects([], [])

			const res = await request(app).get('/api/mods/profiles')

			expect(res.status).toBe(200)
			expect(res.body).toEqual([])
		})

		it('returns 404 for an unknown slug', async () => {
			;(db as any).query = {
				...(db as any).query,
				modProfiles: { findFirst: vi.fn().mockResolvedValue(undefined) },
			}

			const res = await request(app).get('/api/mods/profiles/nope')

			expect(res.status).toBe(404)
		})

		it('returns one profile by slug', async () => {
			;(db as any).query = {
				...(db as any).query,
				modProfiles: { findFirst: vi.fn().mockResolvedValue(profile) },
			}
			mockSelects([entry])

			const res = await request(app).get('/api/mods/profiles/mppvp')

			expect(res.status).toBe(200)
			expectShape(res.body, PROD_PROFILE_KEYS)
			expect(res.body.entries).toHaveLength(1)
		})
	})
})
