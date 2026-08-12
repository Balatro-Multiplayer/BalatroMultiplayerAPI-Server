import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppError } from '../../shared/utils/errors.js'

// LAUNCHER_RELEASES_DIR is read once at env.js's module-load time, so it
// must be set before this module (and anything importing env.js) is ever
// imported -- a dynamic import after setting process.env, rather than a
// static top-level import, is what makes that ordering possible.
// biome-ignore format: biome's own wrapping of this `typeof import(...)` type
// position adds a trailing comma that esbuild/tsc rejects as a syntax error
// -- keep this on one line.
let storage: typeof import('../../features/launcher-releases/launcher-release-storage.js')
let tmpRoot: string

beforeAll(async () => {
	tmpRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), 'launcher-releases-storage-test-'),
	)
	process.env.LAUNCHER_RELEASES_DIR = tmpRoot
	storage = await import(
		'../../features/launcher-releases/launcher-release-storage.js'
	)
})

afterAll(async () => {
	await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('assertSafeVersion', () => {
	it('accepts a normal version string', () => {
		expect(() => storage.assertSafeVersion('1.2.3')).not.toThrow()
	})

	it('rejects path traversal', () => {
		expect(() => storage.assertSafeVersion('../../etc/passwd')).toThrow(
			AppError,
		)
	})

	it('rejects a version containing a path separator', () => {
		expect(() => storage.assertSafeVersion('1.2/3')).toThrow(AppError)
	})

	it('rejects an empty string', () => {
		expect(() => storage.assertSafeVersion('')).toThrow(AppError)
	})
})

describe('writeAsset / openAssetStream / deleteAsset / deleteVersionDir', () => {
	async function makeUploadedFile(contents: string): Promise<string> {
		const p = path.join(tmpRoot, `upload-${Math.random()}.tmp`)
		await fs.writeFile(p, contents)
		return p
	}

	it('moves the source file into place and returns its hash/size', async () => {
		const src = await makeUploadedFile('hello world')
		const result = await storage.writeAsset('1.0.0', 'windows', '.exe', src)

		expect(result.fileSize).toBe(11)
		expect(result.sha256).toHaveLength(64)
		expect(result.storagePath).toBe(path.join('1.0.0', 'windows.exe'))

		// Source file was moved, not copied.
		await expect(fs.access(src)).rejects.toThrow()
	})

	it('round-trips readable content through openAssetStream', async () => {
		const src = await makeUploadedFile('round trip contents')
		const { storagePath } = await storage.writeAsset(
			'1.0.1',
			'mac',
			'.dmg',
			src,
		)

		const chunks: Buffer[] = []
		await new Promise<void>((resolve, reject) => {
			const stream = storage.openAssetStream(storagePath)
			stream.on('data', (c) => chunks.push(c as Buffer))
			stream.on('end', () => resolve())
			stream.on('error', reject)
		})
		expect(Buffer.concat(chunks).toString('utf-8')).toBe('round trip contents')
	})

	it('deleteAsset removes just the file', async () => {
		const src = await makeUploadedFile('to be deleted')
		const { storagePath } = await storage.writeAsset(
			'1.0.2',
			'linux',
			'.AppImage',
			src,
		)
		await storage.deleteAsset(storagePath)
		await expect(fs.access(path.join(tmpRoot, storagePath))).rejects.toThrow()
	})

	it('deleteVersionDir removes the whole version directory', async () => {
		const src = await makeUploadedFile('version dir contents')
		await storage.writeAsset('1.0.3', 'windows', '.exe', src)
		await storage.deleteVersionDir('1.0.3')
		await expect(fs.access(path.join(tmpRoot, '1.0.3'))).rejects.toThrow()
	})

	it('deleteAsset/deleteVersionDir on a missing path do not throw', async () => {
		await expect(storage.deleteAsset('nope/nope.exe')).resolves.toBeUndefined()
		await expect(
			storage.deleteVersionDir('never-existed'),
		).resolves.toBeUndefined()
	})
})
