import { Router } from 'express'
import type { LauncherPlatform } from '../../infrastructure/db/schema.js'
import {
	getAsset,
	getLatestRelease,
	getReleaseByVersion,
} from '../../infrastructure/gateways/launcher-releases.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import * as storage from '../launcher-releases/launcher-release-storage.js'

// Public, launcher-facing endpoints -- no auth, matching the old
// GET /api/releases precedent ("the launcher polls it"). The new (private)
// launcher's own client-side "am I on latest, download, replace myself"
// logic lives in that separate repo and consumes only these two endpoints;
// nothing about keeping new-launcher's source private requires the compiled
// binary or this update-check to be authenticated.
const router = Router()

const PLATFORMS: readonly LauncherPlatform[] = ['windows', 'mac', 'linux']

const MIME_TYPES: Record<string, string> = {
	'.exe': 'application/vnd.microsoft.portable-executable',
	'.msi': 'application/x-msi',
	'.dmg': 'application/x-apple-diskimage',
	'.zip': 'application/zip',
	'.appimage': 'application/x-executable',
	'.deb': 'application/vnd.debian.binary-package',
	'.tar.gz': 'application/gzip',
}

function extname(filename: string): string {
	const lower = filename.toLowerCase()
	if (lower.endsWith('.tar.gz')) return '.tar.gz'
	const dot = lower.lastIndexOf('.')
	return dot === -1 ? '' : lower.slice(dot)
}

// Returns every platform in one payload rather than requiring three
// requests -- the launcher already knows its own OS, this just avoids a
// round trip per platform. A platform key is `null` when nothing's been
// uploaded for it yet (not a 404) -- 404 is reserved for "no release has
// ever been uploaded at all".
router.get('/latest', async (_req, res, next) => {
	try {
		const release = await getLatestRelease()
		if (!release) {
			res.status(404).json({ error: 'No launcher release available' })
			return
		}

		const platforms: Record<LauncherPlatform, unknown> = {
			windows: null,
			mac: null,
			linux: null,
		}
		for (const asset of release.assets) {
			platforms[asset.platform] = {
				downloadUrl: `/api/launcher/download/${release.version}/${asset.platform}`,
				sha256: asset.sha256,
				fileSize: asset.fileSize,
				filename: asset.originalFilename,
			}
		}

		res.json({
			version: release.version,
			releasedAt: release.createdAt,
			platforms,
		})
	} catch (err) {
		next(err)
	}
})

router.get('/download/:version/:platform', async (req, res, next) => {
	try {
		const { version, platform } = req.params
		if (!PLATFORMS.includes(platform as LauncherPlatform)) {
			throw new AppError('Invalid platform', 400)
		}
		// Re-validate even though only admin-sanitized versions are ever
		// stored -- this route is public, treat params as hostile.
		storage.assertSafeVersion(version)

		const release = await getReleaseByVersion(version)
		if (!release) throw new AppError('Release not found', 404)
		const asset = await getAsset(release.id, platform as LauncherPlatform)
		if (!asset) throw new AppError('No binary for this platform', 404)

		res.setHeader(
			'Content-Type',
			MIME_TYPES[extname(asset.originalFilename)] ?? 'application/octet-stream',
		)
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${asset.originalFilename}"`,
		)
		res.setHeader('Content-Length', String(asset.fileSize))

		const stream = storage.openAssetStream(asset.storagePath)
		stream.on('error', next)
		stream.pipe(res)
	} catch (err) {
		next(err)
	}
})

export default router
