import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { relocateModRoot } from './mod-archive-flatten.js'
import { computeModFolderHash } from './mod-folder-hash.js'

const HASH_FETCH_TIMEOUT_MS = 30_000

// How an extracted archive becomes a deployed mod folder. 'thunderstore'
// packages deploy exactly as shipped -- they're built for r2modman, which
// copies them verbatim, and flattening breaks lovely-module packages whose
// root patches load a subfolder. Every other source ('github': GitHub
// zipballs, release assets, admin raw URLs) goes through the canonical
// flatten. The launcher applies the same rule per version source.
export type ModLayout = 'thunderstore' | 'github'

export async function applyLayout(
	extractedDir: string,
	layout: ModLayout,
): Promise<void> {
	if (layout === 'github') await relocateModRoot(extractedDir)
}

// tmpRoot's own random suffix already guarantees uniqueness between
// concurrent callers -- extractedDir just needs *a* name, since the folder's
// own name never enters the hash (computeModFolderHash() hashes paths
// relative to it). Kept version-derived purely for readability.
function extractedFolderName(version: string): string {
	const sanitized = version.replace(/[@/\\]/g, '_')
	return `${sanitized || '_default'}_extracted`
}

// Reproduces exactly what the launcher deploys into a player's Mods folder:
// downloads the archive, extracts it, lays it out per `layout`, then hashes
// the resulting folder (computeModFolderHash(), a port of the launcher's
// ModFileHash::hashDirectory()). Called when an admin pins a version and by
// the sync for a pin that has no hash yet -- only ranked pins are hashed.
// Best-effort: a dead URL or unreadable archive logs and returns null.
export async function computeModFolderHashForRelease(
	modId: string,
	version: string,
	downloadUrl: string,
	layout: ModLayout,
): Promise<string | null> {
	let tmpRoot: string | null = null
	try {
		const res = await fetch(downloadUrl, {
			signal: AbortSignal.timeout(HASH_FETCH_TIMEOUT_MS),
		})
		if (!res.ok) {
			console.error(
				`[mod-version-hash] Hash fetch failed (${res.status}) for ${downloadUrl}`,
			)
			return null
		}
		const rawBytes = Buffer.from(await res.arrayBuffer())

		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bmp-mod-hash-'))
		const extractedDir = path.join(tmpRoot, extractedFolderName(version))
		await fs.mkdir(extractedDir, { recursive: true })

		new AdmZip(rawBytes).extractAllTo(extractedDir, true)
		await applyLayout(extractedDir, layout)

		return await computeModFolderHash(extractedDir)
	} catch (err) {
		console.error(`[mod-version-hash] Failed to hash ${modId}@${version}:`, err)
		return null
	} finally {
		if (tmpRoot) {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	}
}
