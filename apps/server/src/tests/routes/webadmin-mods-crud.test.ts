import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as modsSyncService from '../../features/mods/mods-sync.service.js'
import * as modsGateway from '../../infrastructure/gateways/mods.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/mods.gateway.js', async () => {
	const actual = await vi.importActual<
		typeof import('../../infrastructure/gateways/mods.gateway.js')
	>('../../infrastructure/gateways/mods.gateway.js')
	return {
		...actual,
		setRankedVersion: vi.fn(),
		setFeatured: vi.fn(),
		createCustomMod: vi.fn(),
		updateCustomMod: vi.fn(),
		deleteCustomMod: vi.fn(),
		getPublicModById: vi.fn(),
		upsertProfileEntry: vi.fn(),
		updateModFields: vi.fn(),
		resetModFieldOverrides: vi.fn(),
		getStoredHash: vi.fn(),
	}
})

// ensureVersionHashed lives in mods-sync.service.js (not mods.gateway.js) --
// mocked here too so the PUT ranked-version hash-recovery path and the
// PATCH/POST sourceInput resolution paths below never touch the real
// (unmocked-in-this-file) db.
vi.mock('../../features/mods/mods-sync.service.js', async () => {
	const actual = await vi.importActual<
		typeof import('../../features/mods/mods-sync.service.js')
	>('../../features/mods/mods-sync.service.js')
	return {
		...actual,
		ensureVersionHashed: vi.fn(),
	}
})

const app = createTestApp()

function authAsModerator(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['moderator'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function authAsAdmin(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['admin'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

describe('PUT /api/webadmin/mods/:modId', () => {
	const releaseMod = {
		id: 'Author@Mod',
		latestDownloadUrl:
			'https://github.com/author/mod/releases/download/v1.2.3/mod.zip',
		latestVersion: '1.2.3',
		versions: [
			{
				version: '1.2.3',
				downloadUrl: 'https://github.com/author/mod/releases/download/v1.2.3/mod.zip',
				sha256: 'already-hashed-1-2-3',
			},
			{
				version: '1.0.0',
				downloadUrl: 'https://github.com/author/mod/releases/download/v1.0.0/mod.zip',
				sha256: null,
			},
		],
	}
	const branchMod = {
		id: 'Author@Mod',
		latestDownloadUrl:
			'https://github.com/author/mod/archive/refs/heads/main.zip',
		latestVersion: 'abcdef1',
		versions: [{ version: 'abcdef1' }],
	}
	const customMod = {
		id: 'Author@Mod',
		latestDownloadUrl: 'https://example.com/mod.zip',
		latestVersion: '1.0.0',
		versions: [{ version: '1.0.0' }],
	}

	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-ranked-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.2.3' })

		expect(res.status).toBe(403)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('returns 400 when no field is present', async () => {
		const token = authAsAdmin('admin-ranked-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(400)
	})

	it('returns 400 when rankedVersion is not a string or null', async () => {
		const token = authAsAdmin('admin-ranked-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: 5 })

		expect(res.status).toBe(400)
	})

	it('sets rankedVersion for an admin when it is a known version of a release-type mod', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(releaseMod as any)
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-3', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.2.3' })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			'1.2.3',
		)
	})

	it('rejects rankedVersion for a release-type mod when it is not a known version', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(releaseMod as any)
		const token = authAsAdmin('admin-ranked-3b', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '9.9.9' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
		expect(modsSyncService.ensureVersionHashed).not.toHaveBeenCalled()
	})

	it('hashes a known-but-unhashed historical version on the fly, then pins it (Thunderstore-style version history)', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(releaseMod as any)
		vi.mocked(modsSyncService.ensureVersionHashed).mockImplementation(async () => {
			vi.mocked(modsGateway.getStoredHash).mockResolvedValue('freshly-computed-hash')
		})
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)

		const token = authAsAdmin('admin-ranked-hist-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			// '1.0.0' is a real row in releaseMod.versions, but sha256: null --
			// unlike '1.2.3' (the mod's own latestVersion, already hashed).
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(200)
		expect(modsSyncService.ensureVersionHashed).toHaveBeenCalledWith(
			'Author@Mod',
			'1.0.0',
			// The historical version's own downloadUrl -- never the mod's
			// current latestDownloadUrl, which would hash the wrong content.
			'https://github.com/author/mod/releases/download/v1.0.0/mod.zip',
		)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith('Author@Mod', '1.0.0')
	})

	it("rejects a known-but-unhashed historical version when it still can't be hashed", async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(releaseMod as any)
		vi.mocked(modsSyncService.ensureVersionHashed).mockResolvedValue(undefined)
		vi.mocked(modsGateway.getStoredHash).mockResolvedValue(null)

		const token = authAsAdmin('admin-ranked-hist-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('accepts rankedVersion for a branch-tracked mod when it matches the current version', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(branchMod as any)
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-3c', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: 'abcdef1' })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			'abcdef1',
		)
	})

	it('rejects rankedVersion for a branch-tracked mod when it is not the current version', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(branchMod as any)
		const token = authAsAdmin('admin-ranked-3d', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: 'stale99' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('rejects any rankedVersion for a custom-hosted mod', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(customMod as any)
		const token = authAsAdmin('admin-ranked-3e', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('allows clearing rankedVersion to null without any source validation', async () => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-4', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: null })

		expect(res.status).toBe(200)
		expect(modsGateway.getPublicModById).not.toHaveBeenCalled()
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			null,
		)
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(null)
		const token = authAsAdmin('admin-ranked-5', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Nobody@Nothing')
			.set('Authorization', token)
			.send({ rankedVersion: '1.2.3' })

		expect(res.status).toBe(404)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('returns 400 when featured is not a boolean', async () => {
		const token = authAsAdmin('admin-ranked-6', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ featured: 'yes' })

		expect(res.status).toBe(400)
	})

	it('sets featured for an admin, independently of rankedVersion', async () => {
		vi.mocked(modsGateway.setFeatured).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-7', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ featured: true })

		expect(res.status).toBe(200)
		expect(modsGateway.setFeatured).toHaveBeenCalledWith('Author@Mod', true)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})
})

describe('PATCH /api/webadmin/mods/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-patch-1', 'Mod')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ description: 'New description' })

		expect(res.status).toBe(403)
		expect(modsGateway.updateModFields).not.toHaveBeenCalled()
	})

	it('returns 400 when no field is present', async () => {
		const token = authAsAdmin('admin-patch-1', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(400)
	})

	it('returns 400 for a malformed field', async () => {
		const token = authAsAdmin('admin-patch-2', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ categories: 'not-an-array' })

		expect(res.status).toBe(400)
	})

	it('updates only the fields present in the body for an admin', async () => {
		vi.mocked(modsGateway.updateModFields).mockResolvedValue({
			id: 'Author@Mod',
			description: 'New description',
		} as any)
		const token = authAsAdmin('admin-patch-3', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ description: 'New description' })

		expect(res.status).toBe(200)
		expect(modsGateway.updateModFields).toHaveBeenCalledWith('Author@Mod', {
			description: 'New description',
		})
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.updateModFields).mockResolvedValue(null)
		const token = authAsAdmin('admin-patch-4', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Nobody@Nothing')
			.set('Authorization', token)
			.send({ description: 'New description' })

		expect(res.status).toBe(404)
	})

	// sourceInput (Branch/Release mode - see mod-form-dialog.tsx) resolves
	// latestDownloadUrl/latestVersion server-side via a real GitHub call
	// instead of the admin typing a raw URL - see
	// custom-mod-version-check.service.ts's resolveSourceInput.
	describe('sourceInput', () => {
		function jsonResponse(status: number, body: unknown): Response {
			return new Response(JSON.stringify(body), { status })
		}
		function mockFetch(handler: (url: string) => Response) {
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: string | URL) => handler(input.toString())),
			)
		}

		it('branch: resolves and overrides any directly-sent latestDownloadUrl/latestVersion', async () => {
			mockFetch((url) => {
				if (url.endsWith('/repos/Author/Mod/commits/dev')) {
					return jsonResponse(200, { sha: 'aaaaaaaaaaaaaaaa' })
				}
				throw new Error(`unexpected fetch: ${url}`)
			})
			vi.mocked(modsGateway.updateModFields).mockResolvedValue({
				id: 'Author@Mod',
			} as any)

			const token = authAsAdmin('admin-patch-branch', 'Admin')
			const res = await request(app)
				.patch('/api/webadmin/mods/Author@Mod')
				.set('Authorization', token)
				.send({
					latestDownloadUrl: 'https://should-be-ignored.example/x.zip',
					sourceInput: {
						sourceType: 'branch',
						repoUrl: 'https://github.com/Author/Mod',
						branch: 'dev',
					},
				})

			expect(res.status).toBe(200)
			expect(modsGateway.updateModFields).toHaveBeenCalledWith('Author@Mod', {
				latestDownloadUrl:
					'https://github.com/Author/Mod/archive/refs/heads/dev.zip',
				latestVersion: 'aaaaaaa',
			})
			vi.unstubAllGlobals()
		})

		it('release: resolves the latest tag', async () => {
			mockFetch((url) => {
				if (url.endsWith('/repos/Author/Mod/releases/latest')) {
					return jsonResponse(200, { tag_name: 'v2.0.0' })
				}
				throw new Error(`unexpected fetch: ${url}`)
			})
			vi.mocked(modsGateway.updateModFields).mockResolvedValue({
				id: 'Author@Mod',
			} as any)

			const token = authAsAdmin('admin-patch-release', 'Admin')
			const res = await request(app)
				.patch('/api/webadmin/mods/Author@Mod')
				.set('Authorization', token)
				.send({
					sourceInput: {
						sourceType: 'release',
						repoUrl: 'https://github.com/Author/Mod',
					},
				})

			expect(res.status).toBe(200)
			expect(modsGateway.updateModFields).toHaveBeenCalledWith('Author@Mod', {
				latestDownloadUrl:
					'https://github.com/Author/Mod/archive/refs/tags/v2.0.0.zip',
				latestVersion: 'v2.0.0',
			})
			vi.unstubAllGlobals()
		})

		it('release: returns an error (not a silent success) when the repo has zero releases', async () => {
			mockFetch(() => jsonResponse(404, {}))

			const token = authAsAdmin('admin-patch-release-none', 'Admin')
			const res = await request(app)
				.patch('/api/webadmin/mods/Author@Mod')
				.set('Authorization', token)
				.send({
					sourceInput: {
						sourceType: 'release',
						repoUrl: 'https://github.com/Author/Mod',
					},
				})

			expect(res.status).toBeGreaterThanOrEqual(400)
			expect(modsGateway.updateModFields).not.toHaveBeenCalled()
			vi.unstubAllGlobals()
		})

		it("returns 400 for an unrecognized sourceInput.sourceType ('custom' isn't valid here)", async () => {
			const token = authAsAdmin('admin-patch-source-bad', 'Admin')
			const res = await request(app)
				.patch('/api/webadmin/mods/Author@Mod')
				.set('Authorization', token)
				.send({ sourceInput: { sourceType: 'custom', url: 'x' } })

			expect(res.status).toBe(400)
			expect(modsGateway.updateModFields).not.toHaveBeenCalled()
		})
	})
})

describe('POST /api/webadmin/mods/:modId/reset-overrides', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-reset-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(403)
		expect(modsGateway.resetModFieldOverrides).not.toHaveBeenCalled()
	})

	it('returns 400 when fields is not a string array', async () => {
		const token = authAsAdmin('admin-reset-1', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({ fields: [1, 2] })

		expect(res.status).toBe(400)
	})

	it('resets the given fields for an admin', async () => {
		vi.mocked(modsGateway.resetModFieldOverrides).mockResolvedValue(true)
		const token = authAsAdmin('admin-reset-2', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({ fields: ['description'] })

		expect(res.status).toBe(200)
		expect(modsGateway.resetModFieldOverrides).toHaveBeenCalledWith(
			'Author@Mod',
			['description'],
		)
	})

	it('resets every overridden field when fields is omitted', async () => {
		vi.mocked(modsGateway.resetModFieldOverrides).mockResolvedValue(true)
		const token = authAsAdmin('admin-reset-3', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(200)
		expect(modsGateway.resetModFieldOverrides).toHaveBeenCalledWith(
			'Author@Mod',
			undefined,
		)
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.resetModFieldOverrides).mockResolvedValue(false)
		const token = authAsAdmin('admin-reset-4', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Nobody@Nothing/reset-overrides')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(404)
	})
})

describe('DELETE /api/webadmin/mods/:modId/ranked', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-clear-1', 'Mod')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod/ranked')
			.set('Authorization', token)

		expect(res.status).toBe(403)
	})

	it('clears rankedVersion for an admin', async () => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-clear-1', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod/ranked')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			null,
		)
	})
})

describe('POST /api/webadmin/mods', () => {
	const validBody = { id: 'Custom@Mod', title: 'Custom Mod', author: 'Someone' }

	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-create-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(res.status).toBe(403)
		expect(modsGateway.createCustomMod).not.toHaveBeenCalled()
	})

	it('returns 400 when id/title/author is missing', async () => {
		const token = authAsAdmin('admin-create-1', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({ id: 'Custom@Mod', title: 'Custom Mod' })

		expect(res.status).toBe(400)
	})

	it('creates a custom mod for an admin', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue({
			...validBody,
			isCustom: true,
		} as any)
		const token = authAsAdmin('admin-create-2', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(res.status).toBe(201)
		expect(res.body.isCustom).toBe(true)
	})

	it('returns 409 on an id collision', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue(null)
		const token = authAsAdmin('admin-create-3', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(res.status).toBe(409)
	})

	it('sourceInput (branch): resolves the URL/version and forces automaticVersionCheck on', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = input.toString()
				if (url.endsWith('/repos/Author/Mod/commits/main')) {
					return new Response(JSON.stringify({ sha: 'bbbbbbbbbbbbbbbb' }), {
						status: 200,
					})
				}
				throw new Error(`unexpected fetch: ${url}`)
			}),
		)
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue({
			...validBody,
			isCustom: true,
		} as any)

		const token = authAsAdmin('admin-create-branch', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({
				...validBody,
				automaticVersionCheck: false, // must be overridden to true below
				sourceInput: {
					sourceType: 'branch',
					repoUrl: 'https://github.com/Author/Mod',
					branch: 'main',
				},
			})

		expect(res.status).toBe(201)
		expect(modsGateway.createCustomMod).toHaveBeenCalledWith(
			expect.objectContaining({
				latestDownloadUrl:
					'https://github.com/Author/Mod/archive/refs/heads/main.zip',
				latestVersion: 'bbbbbbb',
				automaticVersionCheck: true,
			}),
		)
		vi.unstubAllGlobals()
	})

	it('defaults automaticVersionCheck/fixedReleaseTagUpdates to undefined when omitted', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue({
			...validBody,
			isCustom: true,
		} as any)
		const token = authAsAdmin('admin-create-4', 'Admin')
		await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(modsGateway.createCustomMod).toHaveBeenCalledWith(
			expect.objectContaining({
				automaticVersionCheck: undefined,
				fixedReleaseTagUpdates: undefined,
			}),
		)
	})

	it('passes automaticVersionCheck/fixedReleaseTagUpdates through when provided', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue({
			...validBody,
			isCustom: true,
		} as any)
		const token = authAsAdmin('admin-create-5', 'Admin')
		await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({
				...validBody,
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			})

		expect(modsGateway.createCustomMod).toHaveBeenCalledWith(
			expect.objectContaining({
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			}),
		)
	})
})

describe('PUT /api/webadmin/mods/:modId/custom', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-edit-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/Custom@Mod/custom')
			.set('Authorization', token)
			.send({ title: 'New Title' })

		expect(res.status).toBe(403)
		expect(modsGateway.updateCustomMod).not.toHaveBeenCalled()
	})

	it('returns 404 when the mod does not exist or is not custom', async () => {
		vi.mocked(modsGateway.updateCustomMod).mockResolvedValue(null)
		const token = authAsAdmin('admin-edit-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Nobody@Nothing/custom')
			.set('Authorization', token)
			.send({ title: 'New Title' })

		expect(res.status).toBe(404)
	})

	it('round-trips field edits, including the two new toggles, for an admin', async () => {
		vi.mocked(modsGateway.updateCustomMod).mockResolvedValue({
			id: 'Custom@Mod',
			title: 'New Title',
			isCustom: true,
			automaticVersionCheck: true,
			fixedReleaseTagUpdates: true,
		} as any)
		const token = authAsAdmin('admin-edit-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Custom@Mod/custom')
			.set('Authorization', token)
			.send({
				title: 'New Title',
				repoUrl: null,
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			})

		expect(res.status).toBe(200)
		expect(res.body.title).toBe('New Title')
		expect(res.body.automaticVersionCheck).toBe(true)
		expect(modsGateway.updateCustomMod).toHaveBeenCalledWith(
			'Custom@Mod',
			expect.objectContaining({
				title: 'New Title',
				repoUrl: null,
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			}),
		)
	})
})

describe('DELETE /api/webadmin/mods/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-delete-1', 'Mod')
		const res = await request(app)
			.delete('/api/webadmin/mods/Custom@Mod')
			.set('Authorization', token)

		expect(res.status).toBe(403)
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(null)
		const token = authAsAdmin('admin-delete-1', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Nobody@Nothing')
			.set('Authorization', token)

		expect(res.status).toBe(404)
	})

	it('returns 400 for a synced (non-custom) mod', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue({
			id: 'Author@Mod',
			isCustom: false,
		} as any)
		const token = authAsAdmin('admin-delete-2', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)

		expect(res.status).toBe(400)
		expect(modsGateway.deleteCustomMod).not.toHaveBeenCalled()
	})

	it('deletes a custom mod for an admin', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue({
			id: 'Custom@Mod',
			isCustom: true,
		} as any)
		vi.mocked(modsGateway.deleteCustomMod).mockResolvedValue(true)
		const token = authAsAdmin('admin-delete-3', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Custom@Mod')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(modsGateway.deleteCustomMod).toHaveBeenCalledWith('Custom@Mod')
	})
})

describe('PUT /api/webadmin/mods/profiles/:id/entries/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-entry-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'latest', allowed: true })

		expect(res.status).toBe(403)
		expect(modsGateway.upsertProfileEntry).not.toHaveBeenCalled()
	})

	it('returns 400 for an unrecognized versionMode', async () => {
		const token = authAsAdmin('admin-entry-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'min:1.0.0', allowed: true })

		expect(res.status).toBe(400)
		expect(modsGateway.upsertProfileEntry).not.toHaveBeenCalled()
	})

	it('returns 400 when versionMode is exact but pinnedVersion is missing', async () => {
		const token = authAsAdmin('admin-entry-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'exact', allowed: true })

		expect(res.status).toBe(400)
		expect(modsGateway.upsertProfileEntry).not.toHaveBeenCalled()
	})

	it('upserts a latestRanked entry, ignoring any stray pinnedVersion', async () => {
		vi.mocked(modsGateway.upsertProfileEntry).mockResolvedValue({} as any)
		const token = authAsAdmin('admin-entry-3', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({
				versionMode: 'latestRanked',
				pinnedVersion: '9.9.9',
				allowed: true,
			})

		expect(res.status).toBe(200)
		expect(modsGateway.upsertProfileEntry).toHaveBeenCalledWith({
			profileId: 'profile-1',
			modId: 'Author@Mod',
			versionMode: 'latestRanked',
			pinnedVersion: null,
			allowed: true,
		})
	})

	it('upserts an exact entry with its pinnedVersion', async () => {
		vi.mocked(modsGateway.upsertProfileEntry).mockResolvedValue({} as any)
		const token = authAsAdmin('admin-entry-4', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'exact', pinnedVersion: '1.2.3', allowed: false })

		expect(res.status).toBe(200)
		expect(modsGateway.upsertProfileEntry).toHaveBeenCalledWith({
			profileId: 'profile-1',
			modId: 'Author@Mod',
			versionMode: 'exact',
			pinnedVersion: '1.2.3',
			allowed: false,
		})
	})
})
