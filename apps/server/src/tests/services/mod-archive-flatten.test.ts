import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { relocateModRoot } from '../../features/mods/mod-archive-flatten.js'

async function makeTree(root: string, files: Record<string, string>): Promise<void> {
	for (const [relativePath, contents] of Object.entries(files)) {
		const full = path.join(root, relativePath)
		await fs.mkdir(path.dirname(full), { recursive: true })
		await fs.writeFile(full, contents)
	}
}

async function listFiles(root: string): Promise<string[]> {
	const out: string[] = []
	async function walk(dir: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				await walk(full)
			} else {
				out.push(path.relative(root, full).split(path.sep).join('/'))
			}
		}
	}
	await walk(root)
	return out.sort()
}

describe('relocateModRoot', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flatten-test-'))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('promotes the shallowest .lua-containing folder and drops everything else', async () => {
		// Mirrors GitHub's zipball_url wrapper shape: <owner>-<repo>-<sha>/
		// with a sibling README the real mod root doesn't own.
		await makeTree(tmpDir, {
			'Author-Mod-abc123/README.md': 'ignore me',
			'Author-Mod-abc123/mod/main.lua': 'return {}',
			'Author-Mod-abc123/mod/assets/icon.png': 'binary',
		})

		await relocateModRoot(tmpDir)

		expect(await listFiles(tmpDir)).toEqual(['assets/icon.png', 'main.lua'])
	})

	it('leaves an already-flat mod untouched', async () => {
		await makeTree(tmpDir, {
			'main.lua': 'return {}',
			'assets/icon.png': 'binary',
		})

		await relocateModRoot(tmpDir)

		expect(await listFiles(tmpDir)).toEqual(['assets/icon.png', 'main.lua'])
	})

	it('unwraps a single non-lua wrapper folder (data-only mod)', async () => {
		await makeTree(tmpDir, {
			'wrapper/data.json': '{}',
			'wrapper/nested/values.csv': 'a,b,c',
		})

		await relocateModRoot(tmpDir)

		expect(await listFiles(tmpDir)).toEqual(['data.json', 'nested/values.csv'])
	})

	it('unwraps multiple nested single-child wrapper folders', async () => {
		await makeTree(tmpDir, {
			'outer/inner/data.json': '{}',
		})

		await relocateModRoot(tmpDir)

		expect(await listFiles(tmpDir)).toEqual(['data.json'])
	})

	it('leaves the structure as-is when multiple .lua-containing folders are equally shallow', async () => {
		await makeTree(tmpDir, {
			'modA/main.lua': 'return {}',
			'modB/main.lua': 'return {}',
		})

		await relocateModRoot(tmpDir)

		expect(await listFiles(tmpDir)).toEqual(['modA/main.lua', 'modB/main.lua'])
	})

	it('matches .lua case-insensitively, like a Windows install would', async () => {
		await makeTree(tmpDir, {
			'wrapper/Main.LUA': 'return {}',
		})

		await relocateModRoot(tmpDir)

		expect(await listFiles(tmpDir)).toEqual(['Main.LUA'])
	})
})
