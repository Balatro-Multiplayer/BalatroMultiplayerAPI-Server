import { Router } from 'express'
import {
	createCustomMod,
	deleteCustomMod,
	findModByIdOrFullName,
	getPublicModById,
	listPinnableVersionsForMod,
	listPublicMods,
	setModFlags,
	setRankedVersion,
	updateCustomMod,
} from '../../infrastructure/gateways/mods.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import {
	type SourceInput,
	resolveSourceInput,
} from '../mods/custom-mod-version-check.service.js'
import { syncModRegistry } from '../mods/mods-sync.service.js'
import { fetchThunderstorePackageVersions } from '../mods/thunderstore-mod-index.service.js'

// Ranked mod catalog admin surface: sync Thunderstore-sourced mods on demand,
// manage the admin-owned fields -- rankedVersion (see schema.ts's own doc
// comment -- a mod is ranked-allowed iff it's non-null), featured and hidden
// -- on every mod, and create/edit/delete custom mods (rows with no
// Thunderstore package). A Thunderstore mod's own fields are read-only here:
// the gateway's custom-mod writes are scoped to isCustom rows in SQL, so
// that holds even if a route check is missed.
//
// Mutations are admin-only (not moderator), matching config.route.ts's
// precedent: this has the same self-inflicted-blast-radius shape as platform
// config. Reads stay at the router-level webAdmin gate (admin OR moderator).
const router = Router()

async function requireAdmin(req: import('express').Request) {
	const actingPlayer = await findPlayerById(req.player!.playerId)
	if (!actingPlayer?.privileges.includes('admin')) {
		throw new AppError('Only admins can edit the ranked mod catalog', 403)
	}
}

// Mirrors the public GET /api/mods (see features/mods/mods.route.ts), plus
// hidden mods so they can be un-hidden.
router.get('/mods', async (_req, res, next) => {
	try {
		res.json(await listPublicMods({ includeHidden: true }))
	} catch (err) {
		next(err)
	}
})

// Manually kicks off the same Thunderstore sync that otherwise only runs at
// server startup and on the hourly interval (see mods-sync.service.ts).
// syncModRegistry() itself dedupes concurrent calls (an in-flight run is
// shared, not duplicated), so this is safe to hit even if the hourly job is
// mid-run.
router.post('/mods/sync', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const summary = await syncModRegistry()
		res.json({ ok: true, ...summary })
	} catch (err) {
		next(err)
	}
})

// The versions the ranked-mods admin UI's version picker offers: a
// Thunderstore mod's list live-proxied straight from Thunderstore (what the
// PUT handler below validates a submitted rankedVersion against), or a custom
// mod's own pinnable version rows.
router.get('/mods/:id/versions', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const mod = await findModByIdOrFullName(req.params.id)
		if (!mod) throw new AppError('Mod not found', 404)
		if (mod.isCustom) {
			res.json(await listPinnableVersionsForMod(mod.id))
			return
		}
		res.json(
			mod.thunderstoreFullName
				? await fetchThunderstorePackageVersions(mod.thunderstoreFullName)
				: [],
		)
	} catch (err) {
		next(err)
	}
})

// Every field is optional; only the ones present are changed.
// rankedVersion is the sole ranked-eligibility signal (see schema.ts's own
// doc comment) -- null un-ranks the mod, any other value ranks it and pins
// it to exactly that version. For a Thunderstore mod a non-null value is
// validated against Thunderstore's own current version list before being
// handed to the gateway (a custom mod's versions are validated by the gateway
// itself), which independently re-resolves and hashes that same version's
// real downloaded/extracted content -- see mods.gateway.ts's
// setRankedVersion doc comment.
router.put('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const body = req.body as {
			rankedVersion?: unknown
			featured?: unknown
			hidden?: unknown
		}
		const { rankedVersion, featured, hidden } = body
		if (
			'rankedVersion' in body &&
			rankedVersion !== null &&
			typeof rankedVersion !== 'string'
		) {
			throw new AppError('rankedVersion must be a string or null', 400)
		}
		if (featured !== undefined && typeof featured !== 'boolean') {
			throw new AppError('featured must be a boolean', 400)
		}
		if (hidden !== undefined && typeof hidden !== 'boolean') {
			throw new AppError('hidden must be a boolean', 400)
		}

		const mod = await findModByIdOrFullName(req.params.modId)
		if (!mod) throw new AppError('Mod not found', 404)

		if (featured !== undefined || hidden !== undefined) {
			await setModFlags(mod.id, { featured, hidden })
		}

		if ('rankedVersion' in body) {
			if (rankedVersion !== null && !mod.isCustom) {
				const versions = mod.thunderstoreFullName
					? await fetchThunderstorePackageVersions(mod.thunderstoreFullName)
					: []
				if (!versions.some((v) => v.version === rankedVersion)) {
					throw new AppError(
						'That version is not currently on Thunderstore',
						400,
					)
				}
			}

			const result = await setRankedVersion(
				mod.id,
				rankedVersion as string | null,
			)
			if (!result.ok) {
				if (result.reason === 'not-found') {
					throw new AppError('Mod not found', 404)
				}
				if (result.reason === 'version-not-found') {
					throw new AppError(
						"That version is not one of this mod's versions",
						400,
					)
				}
				if (result.reason === 'version-not-pinnable') {
					throw new AppError(
						'That version can no longer be pinned: its download URL is a moving pointer (a branch or latest-release link) that now serves a newer version',
						400,
					)
				}
				throw new AppError(
					"Couldn't compute a hash for this version -- check the server logs (mod-version-hash) for why the download/extraction failed, then try again",
					400,
				)
			}
		}
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Turns an admin-supplied `sourceInput` (branch / release: resolved from a
// GitHub repo URL) into the flat latestDownloadUrl / latestVersion fields
// createCustomMod and updateCustomMod take. A raw-URL source needs no
// resolving: the admin sends latestDownloadUrl (and latestVersion) directly.
async function resolveSourceInputField(
	body: Record<string, unknown>,
): Promise<{ latestDownloadUrl: string; latestVersion: string | null } | null> {
	if (body.sourceInput === undefined) return null
	const si = body.sourceInput as Record<string, unknown>
	const requireString = (key: string) => {
		const value = si[key]
		if (typeof value !== 'string' || !value) {
			throw new AppError(
				`sourceInput.${key} is required for ${si.sourceType}`,
				400,
			)
		}
		return value
	}

	let input: SourceInput
	if (si.sourceType === 'branch') {
		input = {
			sourceType: 'branch',
			repoUrl: requireString('repoUrl'),
			branch: requireString('branch'),
		}
	} else if (si.sourceType === 'release') {
		input = { sourceType: 'release', repoUrl: requireString('repoUrl') }
	} else {
		throw new AppError(
			"sourceInput.sourceType must be 'branch' or 'release'",
			400,
		)
	}
	return resolveSourceInput(input)
}

// Reads the editable custom-mod fields off a request body; absent keys stay
// undefined (left untouched by updateCustomMod), an explicit null clears a
// nullable field.
function readCustomModFields(body: Record<string, unknown>) {
	const str = (key: string): string | undefined =>
		typeof body[key] === 'string' ? (body[key] as string) : undefined
	const strOrNull = (key: string): string | null | undefined =>
		body[key] === null ? null : str(key)
	const bool = (key: string): boolean | undefined =>
		typeof body[key] === 'boolean' ? (body[key] as boolean) : undefined
	const strings = (key: string): string[] | undefined =>
		Array.isArray(body[key]) &&
		(body[key] as unknown[]).every((v) => typeof v === 'string')
			? (body[key] as string[])
			: undefined
	return {
		title: str('title'),
		author: str('author'),
		categories: strings('categories'),
		searchTerms: strings('searchTerms'),
		requiresSteamodded: bool('requiresSteamodded'),
		requiresTalisman: bool('requiresTalisman'),
		repoUrl: strOrNull('repoUrl'),
		thumbnailUrl: strOrNull('thumbnailUrl'),
		description: strOrNull('description'),
		latestVersion: strOrNull('latestVersion'),
		latestDownloadUrl: strOrNull('latestDownloadUrl'),
		automaticVersionCheck: bool('automaticVersionCheck'),
		fixedReleaseTagUpdates: bool('fixedReleaseTagUpdates'),
	}
}

// Creates a custom mod: one with no Thunderstore package (a partner mod, a
// GitHub-only mod). The id is admin-chosen and permanent -- clients key on it.
// With a sourceInput (branch / release) the download URL and version are
// resolved from GitHub, and automaticVersionCheck defaults on so the mod
// keeps tracking its source; with a raw latestDownloadUrl nothing is resolved.
router.post('/mods', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const body = req.body as Record<string, unknown>
		const { id, title, author } = body
		if (typeof id !== 'string' || !id) throw new AppError('id is required', 400)
		if (typeof title !== 'string' || !title)
			throw new AppError('title is required', 400)
		if (typeof author !== 'string' || !author)
			throw new AppError('author is required', 400)

		const resolved = await resolveSourceInputField(body)
		const fields = readCustomModFields(body)
		const mod = await createCustomMod({
			...fields,
			id,
			title,
			author,
			repoUrl: fields.repoUrl ?? null,
			...(resolved && {
				latestDownloadUrl: resolved.latestDownloadUrl,
				latestVersion: resolved.latestVersion,
				automaticVersionCheck: fields.automaticVersionCheck ?? true,
			}),
		})
		if (!mod) throw new AppError(`A mod with id '${id}' already exists`, 409)
		res.status(201).json(mod)
	} catch (err) {
		next(err)
	}
})

// Edits a custom mod's own fields (every one optional). Distinct from
// PUT /mods/:modId above, which only touches ranked pin / featured / hidden
// and works on any mod. A Thunderstore mod 404s here: its fields come from
// Thunderstore and are not editable.
router.put('/mods/:modId/custom', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const body = req.body as Record<string, unknown>
		const resolved = await resolveSourceInputField(body)
		const mod = await updateCustomMod(req.params.modId, {
			...readCustomModFields(body),
			...(resolved && {
				latestDownloadUrl: resolved.latestDownloadUrl,
				latestVersion: resolved.latestVersion,
			}),
		})
		if (!mod) throw new AppError('Custom mod not found', 404)
		res.json(mod)
	} catch (err) {
		next(err)
	}
})

// Only a custom mod can be deleted: a Thunderstore mod would just reappear
// on the next sync.
router.delete('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const mod = await findModByIdOrFullName(req.params.modId)
		if (!mod) throw new AppError('Mod not found', 404)
		if (!mod.isCustom) {
			throw new AppError(
				'Only a custom mod can be deleted -- a Thunderstore mod would just reappear on the next sync',
				400,
			)
		}
		await deleteCustomMod(mod.id)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Mirrors the public GET /api/mods/:id. Registered after the more specific
// /mods/:id/versions path above so that path isn't swallowed by this
// wildcard (both share the GET method).
router.get('/mods/:modId', async (req, res, next) => {
	try {
		const mod = await getPublicModById(req.params.modId, {
			includeHidden: true,
		})
		if (!mod) throw new AppError('Mod not found', 404)
		res.json(mod)
	} catch (err) {
		next(err)
	}
})

export default router
