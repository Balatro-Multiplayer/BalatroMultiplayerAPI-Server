import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import {
	type ModIndexEntryInput,
	upsertModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'

// Mirrors mods.test.ts's drizzle chain-mocking pattern -- upsertModFromIndex
// isn't otherwise injectable, it calls db directly.
function mockFindFirst(row: unknown) {
	return {
		findFirst: vi.fn().mockResolvedValue(row),
	}
}

function mockInsertCapturingSet(onSet: (set: Record<string, unknown>) => void) {
	return vi.fn().mockReturnValue({
		values: vi.fn().mockReturnValue({
			onConflictDoUpdate: vi.fn().mockImplementation(({ set }) => {
				onSet(set)
				return Promise.resolve()
			}),
		}),
	})
}

const entry: ModIndexEntryInput = {
	id: 'Author@Mod',
	title: 'New Title',
	author: 'Author',
	categories: ['utility'],
	requiresSteamodded: true,
	requiresTalisman: false,
	repoUrl: 'https://example.com/repo',
	thumbnailUrl: 'https://example.com/thumb.png',
	description: 'New description',
	latestVersion: '2.0.0',
	latestDownloadUrl: 'https://example.com/dl.zip',
	versions: [],
}

describe('upsertModFromIndex', () => {
	it('overwrites every syncable field when nothing is overridden', async () => {
		;(db as any).query = {
			...(db as any).query,
			modRegistry: mockFindFirst({ overriddenFields: [] }),
		}
		let captured: Record<string, unknown> = {}
		;(db as any).insert = mockInsertCapturingSet((set) => {
			captured = set
		})

		await upsertModFromIndex(entry, 'github')

		expect(captured.title).toBe('New Title')
		expect(captured.description).toBe('New description')
		expect(captured.latestVersion).toBe('2.0.0')
		expect(captured.indexSource).toBe('github')
	})

	it('skips fields present in overriddenFields but still updates the rest', async () => {
		;(db as any).query = {
			...(db as any).query,
			modRegistry: mockFindFirst({
				overriddenFields: ['description', 'title'],
			}),
		}
		let captured: Record<string, unknown> = {}
		;(db as any).insert = mockInsertCapturingSet((set) => {
			captured = set
		})

		await upsertModFromIndex(entry, 'github')

		expect(captured.title).toBeUndefined()
		expect(captured.description).toBeUndefined()
		expect(captured.latestVersion).toBe('2.0.0')
		expect(captured.categories).toEqual(['utility'])
		// indexSource is bookkeeping, not a syncable field -- always written
		// even when title/description are overridden and skipped above.
		expect(captured.indexSource).toBe('github')
	})

	it('overwrites everything for a brand-new mod with no existing row', async () => {
		;(db as any).query = {
			...(db as any).query,
			modRegistry: mockFindFirst(undefined),
		}
		let captured: Record<string, unknown> = {}
		;(db as any).insert = mockInsertCapturingSet((set) => {
			captured = set
		})

		await upsertModFromIndex(entry, 'thunderstore')

		expect(captured.title).toBe('New Title')
		expect(captured.description).toBe('New description')
		expect(captured.indexSource).toBe('thunderstore')
	})
})
