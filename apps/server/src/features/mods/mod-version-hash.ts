import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { relocateModRoot } from './mod-archive-flatten.js'
import { computeModFolderHash } from './mod-folder-hash.js'

const HASH_FETCH_TIMEOUT_MS = 30_000

// tmpRoot's own random suffix already guarantees uniqueness between
// concurrent callers (including two different mods that happen to share a
// version string) -- extractedDir just needs *a* name, since the folder's
// own name never enters the hash itself (computeModFolderHash() hashes paths
// relative to it -- see that module's own comment). Kept version-derived
// anyway purely for readability if this temp dir is ever inspected mid-run.
function extractedFolderName(version: string): string {
	const sanitized = version.replace(/[@/\\]/g, '_')
	return `${sanitized || '_default'}_extracted`
}

// Reproduces exactly what the launcher's ModInstaller deploys into a
// player's Mods folder: downloads the raw release archive, extracts it,
// flattens/relocates its real mod-root folder (see mod-archive-flatten.ts,
// a port of relocateModRoot()), then hashes that flattened folder's content
// directly (computeModFolderHash() -- a port of the launcher's own
// ModFileHash::hashDirectory()). Hashes *that*, not the raw download,
// because the raw download is never what actually lands in a player's Mods
// folder, or what RunController::currentModMatchesServerHash() verifies
// against. Called from mods.gateway.ts's setRankedVersion when an admin pins a
// version, and from mods-sync.service.ts for a pin that has no hash yet --
// only ranked pins are ever hashed, not every mod's every version.
// Best-effort: a slow/dead
// download URL or an unreadable archive logs and returns null rather than
// throwing.
export async function computeModFolderHashForRelease(
	modId: string,
	version: string,
	downloadUrl: string,
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
		await relocateModRoot(extractedDir)

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
