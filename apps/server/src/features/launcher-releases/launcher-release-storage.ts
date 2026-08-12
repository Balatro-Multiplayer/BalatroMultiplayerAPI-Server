import { createHash } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import { env } from '../../env.js'
import type { LauncherPlatform } from '../../infrastructure/db/schema.js'
import { AppError } from '../../shared/utils/errors.js'

const ROOT = path.resolve(env.LAUNCHER_RELEASES_DIR)

// Version is admin-submitted form input that ends up as a path segment --
// reject anything outside a safe charset (no '/', '..', null bytes, etc.)
// rather than trying to sanitize it, so the stored `version` column always
// matches what's actually on disk.
const VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/

export function assertSafeVersion(version: string): void {
	if (!VERSION_RE.test(version)) {
		throw new AppError(
			'version must be 1-64 characters of letters, digits, "." "_" "-"',
			400,
		)
	}
}

// {root}/{version}/{platform}.{ext} -- one directory per version, so
// deleting a whole release is a single recursive rm rather than three
// individual unlinks.
function versionDir(version: string): string {
	assertSafeVersion(version)
	return path.join(ROOT, version)
}

function assetAbsolutePath(
	version: string,
	platform: LauncherPlatform,
	ext: string,
): string {
	return path.join(versionDir(version), `${platform}${ext}`)
}

export interface WrittenAsset {
	storagePath: string // relative to ROOT -- what gets stored in the DB
	sha256: string
	fileSize: number
}

// Moves an already-fully-uploaded temp file (multer's disk-storage output)
// into its final location, hashing it in the process. Tries a fast rename
// first; falls back to stream-copy + unlink on EXDEV, since the temp file
// (os.tmpdir()) and ROOT (a separate mounted volume in production) are
// commonly on different filesystems.
export async function writeAsset(
	version: string,
	platform: LauncherPlatform,
	ext: string,
	sourceFilePath: string,
): Promise<WrittenAsset> {
	const destAbsolute = assetAbsolutePath(version, platform, ext)
	await fs.mkdir(path.dirname(destAbsolute), { recursive: true })

	const sha256 = await hashFile(sourceFilePath)
	const { size: fileSize } = await fs.stat(sourceFilePath)

	try {
		await fs.rename(sourceFilePath, destAbsolute)
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
		await fs.copyFile(sourceFilePath, destAbsolute)
		await fs.rm(sourceFilePath, { force: true })
	}

	return {
		storagePath: path.relative(ROOT, destAbsolute),
		sha256,
		fileSize,
	}
}

function hashFile(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256')
		const stream = createReadStream(filePath)
		stream.on('data', (chunk) => hash.update(chunk))
		stream.on('error', reject)
		stream.on('end', () => resolve(hash.digest('hex')))
	})
}

// Never buffers the file in memory -- callers pipe this directly to an HTTP
// response.
export function openAssetStream(storagePath: string) {
	return createReadStream(path.join(ROOT, storagePath))
}

export async function deleteAsset(storagePath: string): Promise<void> {
	await fs.rm(path.join(ROOT, storagePath), { force: true })
}

export async function deleteVersionDir(version: string): Promise<void> {
	await fs.rm(versionDir(version), { recursive: true, force: true })
}
