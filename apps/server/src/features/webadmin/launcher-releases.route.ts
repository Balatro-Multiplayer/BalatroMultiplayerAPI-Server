import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import multer, { MulterError } from 'multer'
import type { LauncherPlatform } from '../../infrastructure/db/schema.js'
import {
	deleteAssetRow,
	deleteRelease,
	getAsset,
	getReleaseWithAssetsById,
	listReleases,
	upsertAsset,
	upsertRelease,
} from '../../infrastructure/gateways/launcher-releases.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import * as storage from '../launcher-releases/launcher-release-storage.js'

// Admin surface for uploading the new (private) launcher's binaries -- see
// features/launcher/launcher.route.ts for the public "check for update" +
// download endpoints these uploads feed. Mutations are admin-only (not
// moderator), same self-inflicted-blast-radius precedent as mods.route.ts's
// requireAdmin. Reads stay at the router-level webAdmin gate.
const router = Router()

async function requireAdmin(req: Request) {
	const actingPlayer = await findPlayerById(req.player!.playerId)
	if (!actingPlayer?.privileges.includes('admin')) {
		throw new AppError('Only admins can manage launcher releases', 403)
	}
}

const PLATFORMS: readonly LauncherPlatform[] = ['windows', 'mac', 'linux']
const ALLOWED_EXTENSIONS: Record<LauncherPlatform, readonly string[]> = {
	// .zip is the actual shape BET's own Windows build produces -- windeployqt
	// bundles Qt DLLs/vc_redist.x64.exe alongside BET.exe, so it ships as a
	// zipped folder, not a bare .exe/.msi installer (see new-launcher's
	// scripts/package-windows.ps1 and CLAUDE.md's Build section).
	windows: ['.exe', '.msi', '.zip'],
	mac: ['.dmg', '.zip'],
	linux: ['.appimage', '.deb', '.tar.gz'],
}
const MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024

function extname(filename: string): string {
	const lower = filename.toLowerCase()
	if (lower.endsWith('.tar.gz')) return '.tar.gz'
	const dot = lower.lastIndexOf('.')
	return dot === -1 ? '' : lower.slice(dot)
}

const upload = multer({
	storage: multer.diskStorage({
		destination: (_req, _file, cb) => cb(null, os.tmpdir()),
		filename: (_req, file, cb) =>
			cb(null, `${randomUUID()}-${file.originalname}`),
	}),
	limits: { fileSize: MAX_FILE_SIZE_BYTES },
	fileFilter: (_req, file, cb) => {
		const platform = file.fieldname as LauncherPlatform
		const allowed = ALLOWED_EXTENSIONS[platform]
		if (!allowed) {
			cb(new AppError(`Unexpected field '${file.fieldname}'`, 400))
			return
		}
		cb(null, allowed.includes(extname(file.originalname)))
	},
}).fields(PLATFORMS.map((platform) => ({ name: platform, maxCount: 1 })))

// Translates multer's own error shape into this app's AppError/errorHandler
// convention (file too large, wrong extension) instead of falling through to
// a generic 500 -- cheap to do and meaningfully clearer for an admin hitting
// the size/extension limits while testing an upload.
function handleUpload(req: Request, res: Response, next: NextFunction) {
	upload(req, res, (err: unknown) => {
		if (!err) {
			next()
			return
		}
		if (err instanceof MulterError) {
			if (err.code === 'LIMIT_FILE_SIZE') {
				next(
					new AppError(
						`File too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`,
						400,
					),
				)
				return
			}
			next(new AppError(err.message, 400))
			return
		}
		next(err)
	})
}

type UploadedFiles = Partial<Record<LauncherPlatform, Express.Multer.File[]>>

router.get('/launcher-releases', async (_req, res, next) => {
	try {
		res.json({ releases: await listReleases() })
	} catch (err) {
		next(err)
	}
})

router.post('/launcher-releases', handleUpload, async (req, res, next) => {
	try {
		await requireAdmin(req)

		const version =
			typeof req.body.version === 'string' ? req.body.version.trim() : ''
		if (!version) throw new AppError('version is required', 400)
		storage.assertSafeVersion(version)

		const files = req.files as UploadedFiles
		const present = PLATFORMS.filter((p) => files[p]?.[0])
		if (present.length === 0) {
			throw new AppError('At least one platform binary is required', 400)
		}

		const notes =
			typeof req.body.notes === 'string' ? req.body.notes : undefined
		const release = await upsertRelease(version, notes)

		for (const platform of present) {
			const file = files[platform]![0]
			const existing = await getAsset(release.id, platform)
			const written = await storage.writeAsset(
				version,
				platform,
				extname(file.originalname),
				file.path,
			)
			await upsertAsset(release.id, platform, {
				storagePath: written.storagePath,
				originalFilename: file.originalname,
				fileSize: written.fileSize,
				sha256: written.sha256,
			})
			if (existing && existing.storagePath !== written.storagePath) {
				await storage.deleteAsset(existing.storagePath)
			}
		}

		console.log(
			`[webadmin] ${req.player!.playerId} uploaded launcher release ${version} (${present.join(', ')})`,
		)
		res
			.status(201)
			.json({ release: await getReleaseWithAssetsById(release.id) })
	} catch (err) {
		next(err)
	}
})

router.delete('/launcher-releases/:id/:platform', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid release id', 400)
		const platform = req.params.platform as LauncherPlatform
		if (!PLATFORMS.includes(platform))
			throw new AppError('Invalid platform', 400)

		const assetRow = await deleteAssetRow(id, platform)
		if (!assetRow) throw new AppError('Asset not found', 404)
		await storage.deleteAsset(assetRow.storagePath)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

router.delete('/launcher-releases/:id', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid release id', 400)

		const release = await deleteRelease(id)
		if (!release) throw new AppError('Release not found', 404)
		await storage.deleteVersionDir(release.version)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
