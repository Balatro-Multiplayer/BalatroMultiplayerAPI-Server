import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractLovelySourcePaths } from '../../features/mods/mod-archive-flatten.js'
import { computeModFolderHash } from '../../features/mods/mod-folder-hash.js'
import {
	type ModLayout,
	applyLayout,
} from '../../features/mods/mod-version-hash.js'
import fixtures from '../fixtures/mod-layouts.json' with { type: 'json' }

// The shared layout fixture list: the launcher's parity check reads the same
// file, so a case passing here and there means both sides deploy -- and
// hash -- the same folder for that archive shape.
interface LayoutCase {
	name: string
	layout: ModLayout
	files: Record<string, string>
	expectedRoot: string
	expectedHash: string
}

async function writeTree(root: string, files: Record<string, string>) {
	for (const [relative, contents] of Object.entries(files)) {
		const full = path.join(root, relative)
		await fs.mkdir(path.dirname(full), { recursive: true })
		await fs.writeFile(full, contents)
	}
}

async function listFiles(root: string): Promise<string[]> {
	const out: string[] = []
	async function walk(dir: string) {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) await walk(full)
			else out.push(path.relative(root, full).split(path.sep).join('/'))
		}
	}
	await walk(root)
	return out.sort()
}

function expectedFiles(c: LayoutCase): string[] {
	const prefix = c.expectedRoot ? `${c.expectedRoot}/` : ''
	return Object.keys(c.files)
		.filter((f) => f.startsWith(prefix))
		.map((f) => f.slice(prefix.length))
		.sort()
}

describe('canonical mod layout (shared fixtures)', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mod-layout-'))
	})
	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	for (const c of fixtures.cases as LayoutCase[]) {
		it(`${c.name} -> ${c.expectedRoot || '<root>'}`, async () => {
			await writeTree(tmpDir, c.files)
			await applyLayout(tmpDir, c.layout)
			expect(await listFiles(tmpDir)).toEqual(expectedFiles(c))
			expect(await computeModFolderHash(tmpDir)).toBe(c.expectedHash)
		})
	}
})

describe('extractLovelySourcePaths', () => {
	it('reads source and sources, skipping comment lines', () => {
		const toml = [
			'[[patches]]',
			'[patches.module]',
			"source = 'a/b.lua'",
			'# source = "commented/out.lua"',
			'[[patches]]',
			'[patches.copy]',
			'sources = [',
			'  "c/d.lua",',
			"  'e/f.lua'",
			']',
		].join('\n')
		expect(extractLovelySourcePaths(toml)).toEqual([
			'a/b.lua',
			'c/d.lua',
			'e/f.lua',
		])
	})
})
