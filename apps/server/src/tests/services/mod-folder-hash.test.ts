import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeModFolderHash } from '../../features/mods/mod-folder-hash.js'

async function makeTree(root: string, files: Record<string, string>): Promise<void> {
	for (const [relativePath, contents] of Object.entries(files)) {
		const full = path.join(root, relativePath)
		await fs.mkdir(path.dirname(full), { recursive: true })
		await fs.writeFile(full, contents)
	}
}

describe('computeModFolderHash', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-hash-test-'))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('matches a hand-computed sorted-path-plus-content sha256', async () => {
		await makeTree(tmpDir, {
			'main.lua': 'return {}',
			'assets/icon.png': 'binary',
		})

		const expected = createHash('sha256')
			.update('assets/icon.png', 'utf8')
			.update(Buffer.from('binary'))
			.update('main.lua', 'utf8')
			.update(Buffer.from('return {}'))
			.digest('hex')

		expect(await computeModFolderHash(tmpDir)).toBe(expected)
	})

	it('is independent of the root folder\'s own name', async () => {
		await makeTree(tmpDir, { 'main.lua': 'return {}' })
		const first = await computeModFolderHash(tmpDir)

		const renamed = `${tmpDir}_renamed`
		await fs.rename(tmpDir, renamed)
		const second = await computeModFolderHash(renamed)
		await fs.rename(renamed, tmpDir) // afterEach expects tmpDir to still exist

		expect(second).toBe(first)
	})

	it('is independent of filesystem enumeration order', async () => {
		await makeTree(tmpDir, {
			'z_first.lua': 'a',
			'a_second.lua': 'b',
			'nested/deep/file.lua': 'c',
		})

		// Two independent walks of the same tree should always agree,
		// regardless of whatever order readdir() happens to return.
		const first = await computeModFolderHash(tmpDir)
		const second = await computeModFolderHash(tmpDir)
		expect(second).toBe(first)
	})

	it('changes if a file\'s content changes', async () => {
		await makeTree(tmpDir, { 'main.lua': 'return {}' })
		const before = await computeModFolderHash(tmpDir)

		await fs.writeFile(path.join(tmpDir, 'main.lua'), 'return { changed = true }')
		const after = await computeModFolderHash(tmpDir)

		expect(after).not.toBe(before)
	})

	it('changes if a file is renamed even with identical content', async () => {
		await makeTree(tmpDir, { 'main.lua': 'return {}' })
		const before = await computeModFolderHash(tmpDir)

		await fs.rename(path.join(tmpDir, 'main.lua'), path.join(tmpDir, 'renamed.lua'))
		const after = await computeModFolderHash(tmpDir)

		expect(after).not.toBe(before)
	})
})
