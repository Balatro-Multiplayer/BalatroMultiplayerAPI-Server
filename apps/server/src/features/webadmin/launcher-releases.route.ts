import type { Request } from 'express'
import { Router } from 'express'
import type { LauncherPlatform } from '../../infrastructure/db/schema.js'
import {
	deleteAssetRow,
	deleteRelease,
	getReleaseWithAssetsById,
	listReleases,
	upsertAsset,
	upsertRelease,
} from '../../infrastructure/gateways/launcher-releases.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import {
	assertSafeVersion,
	listRecentReleases,
	resolveReleaseByTag,
} from '../launcher-releases/launcher-github-releases.service.js'

// Admin surface for importing the new (private) launcher's releases from
// GitHub -- see features/launcher/launcher.route.ts for the public "check
// for update" + download endpoints these imports feed. Mutations are
// admin-only (not moderator), same self-inflicted-blast-radius precedent as
// mods.route.ts's requireAdmin. Reads stay at the router-level webAdmin
// gate.
const router = Router()

async function requireAdmin(req: Request) {
	const actingPlayer = await findPlayerById(req.player!.playerId)
	if (!actingPlayer?.privileges.includes('admin')) {
		throw new AppError('Only admins can manage launcher releases', 403)
	}
}

const PLATFORMS: readonly LauncherPlatform[] = ['windows', 'mac', 'linux']

router.get('/launcher-releases', async (_req, res, next) => {
	try {
		res.json({ releases: await listReleases() })
	} catch (err) {
		next(err)
	}
})

// GitHub releases not yet imported (or already imported, flagged as such)
// for the admin UI's release picker.
router.get('/launcher-releases/github-releases', async (_req, res, next) => {
	try {
		const [ghReleases, imported] = await Promise.all([
			listRecentReleases(),
			listReleases(),
		])
		const importedTags = new Set(imported.map((r) => r.githubReleaseTag))
		res.json({
			releases: ghReleases.map((r) => ({
				...r,
				alreadyImported: importedTags.has(r.tag),
			})),
		})
	} catch (err) {
		next(err)
	}
})

// Resolves a GitHub release tag's assets and persists them as a launcher
// release - no file upload, no bytes touched here at all. Also used by the
// admin UI's per-release "re-sync" action (same tag, already-imported
// version - upsertRelease/upsertAsset just refresh the stored metadata).
router.post('/launcher-releases/from-github', async (req, res, next) => {
	try {
		await requireAdmin(req)

		const tag = typeof req.body.tag === 'string' ? req.body.tag.trim() : ''
		if (!tag) throw new AppError('tag is required', 400)

		const resolved = await resolveReleaseByTag(tag)
		if (!resolved) throw new AppError(`No such release tag '${tag}'`, 404)
		assertSafeVersion(resolved.version)
		if (resolved.assets.length === 0) {
			throw new AppError(
				`Release '${tag}' has no recognized platform assets`,
				400,
			)
		}

		const release = await upsertRelease(resolved.version, tag, resolved.notes)
		for (const asset of resolved.assets) {
			await upsertAsset(release.id, asset.platform, {
				githubAssetId: asset.githubAssetId,
				originalFilename: asset.originalFilename,
				fileSize: asset.fileSize,
				sha256: asset.sha256,
			})
		}

		console.log(
			`[webadmin] ${req.player!.playerId} imported launcher release ${resolved.version} from tag '${tag}' (${resolved.assets.map((a) => a.platform).join(', ')})`,
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
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
