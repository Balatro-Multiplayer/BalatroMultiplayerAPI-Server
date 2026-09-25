import { Readable } from 'node:stream'
import { Router } from 'express'
import { AppError } from '../../shared/utils/errors.js'
import {
	getLatestRelease,
	resolveAssetDownloadStream,
} from './r2modman-github-releases.service.js'

// Public, unauthenticated feed for bmp-r2modman's electron-updater "generic"
// provider (see quasar.config.ts's electron.builder.publish config) - not a
// custom manifest like new-launcher's /api/launcher/latest, this speaks
// electron-updater's actual wire protocol directly so the packaged app needs
// zero special-casing beyond pointing its publish url here.
const router = Router()

const MIME_TYPES: Record<string, string> = {
	'.exe': 'application/vnd.microsoft.portable-executable',
	'.dmg': 'application/x-apple-diskimage',
	'.zip': 'application/zip',
	'.appimage': 'application/x-executable',
	'.deb': 'application/vnd.debian.binary-package',
	'.rpm': 'application/x-rpm',
	'.pacman': 'application/octet-stream',
	'.tar.gz': 'application/gzip',
	'.blockmap': 'application/octet-stream',
	'.yml': 'text/yaml',
}

function extname(filename: string): string {
	const lower = filename.toLowerCase()
	if (lower.endsWith('.tar.gz')) return '.tar.gz'
	const dot = lower.lastIndexOf('.')
	return dot === -1 ? '' : lower.slice(dot)
}

// Single catch-all: electron-updater requests latest.yml/latest-mac.yml/
// latest-linux.yml first, then whatever installer/blockmap filename it finds
// inside that YAML - both are just "a named asset on the latest release" as
// far as this route cares. No URL rewriting is needed anywhere here:
// electron-builder writes bare relative filenames into latest*.yml's
// files[].url/path by default, and GenericProvider resolves those against
// this same base url automatically, so serving the YAML byte-for-byte as
// GitHub has it already points back at this route.
router.get('/:filename', async (req, res, next) => {
	try {
		const { filename } = req.params

		const release = await getLatestRelease()
		if (!release) {
			throw new AppError('No complete bmp-r2modman release available yet', 404)
		}

		// GitHub silently replaces every space in an uploaded release asset's
		// filename with a period (e.g. "r2modman Setup 0.2.0.exe" becomes
		// "r2modman.Setup.0.2.0.exe" server-side) - but electron-builder's
		// generated latest*.yml files still reference the original,
		// space-containing filename verbatim, since that's the actual name
		// on disk at build time. electron-updater then requests that
		// original name from this route unchanged. Fall back to the
		// space-to-period form GitHub actually stored the asset under before
		// giving up, rather than 404ing on every filename that ever had a
		// space in it.
		const assetId =
			release.assetsByName.get(filename) ??
			release.assetsByName.get(filename.replace(/ /g, '.'))
		if (!assetId) {
			throw new AppError(`No such asset '${filename}' on release ${release.tag}`, 404)
		}

		const rangeHeader = req.headers.range
		const githubRes = await resolveAssetDownloadStream(
			assetId,
			typeof rangeHeader === 'string' ? rangeHeader : undefined,
		)

		res.status(githubRes.status)
		res.setHeader('Content-Type', MIME_TYPES[extname(filename)] ?? 'application/octet-stream')
		for (const header of ['content-length', 'content-range', 'accept-ranges']) {
			const value = githubRes.headers.get(header)
			if (value) res.setHeader(header, value)
		}

		const stream = Readable.fromWeb(
			githubRes.body as import('node:stream/web').ReadableStream,
		)
		stream.on('error', next)
		stream.pipe(res)
	} catch (err) {
		next(err)
	}
})

export default router
