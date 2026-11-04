import { Router } from 'express'
import {
	type ModProfileVersionMode,
	modProfileVersionModeEnum,
} from '../../infrastructure/db/schema.js'
import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import {
	type ModProfileFields,
	type PinCommitResult,
	type SaveProfileResult,
	createCustomMod,
	createProfile,
	deleteCustomMod,
	deleteProfile,
	findModByIdOrFullName,
	getPublicModById,
	listPublicMods,
	listPublicProfiles,
	listVersionsForMod,
	pinCommit,
	removeProfileEntry,
	setModFlags,
	setProfileEntry,
	setRankedVersion,
	setSmodsIds,
	setTrackGithub,
	updateCustomMod,
	updateProfile,
} from '../../infrastructure/gateways/mods.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { requireAdmin } from '../../shared/utils/require-admin.js'
import {
	type ResolvedSource,
	type SourceInput,
	resolveSourceInput,
} from '../mods/custom-mod-version-check.service.js'
import { parseSmodsIdsOverride } from '../mods/mod-smods-ids.js'
import { syncModRegistry } from '../mods/mods-sync.service.js'
import { backfillSmodsIds } from '../mods/smods-ids-backfill.service.js'

// Ranked mod catalog admin surface: sync Thunderstore-sourced mods on demand,
// manage the admin-owned fields -- the ranked pin (see schema.ts's own doc
// comment -- a mod is ranked-allowed iff rankedVersion is non-null),
// featured, hidden and trackGithub -- on every mod, and create/edit/delete
// custom mods (rows with no Thunderstore package), and edit the mod profiles
// the launcher offers as presets. A Thunderstore mod's own fields are read-only here:
// the gateway's custom-mod writes are scoped to isCustom rows in SQL, so
// that holds even if a route check is missed.
//
// The whole router is admin-only (webadmin.route.ts); each mutation also
// calls the shared requireAdmin.
const router = Router()

// Mirrors the public GET /api/mods (see features/mods/mods.route.ts), plus
// hidden mods so they can be un-hidden.
router.get('/mods', async (_req, res, next) => {
	try {
		res.json(await listPublicMods({ includeHidden: true }))
	} catch (err) {
		next(err)
	}
})

// --- Mod profiles: the named presets the launcher offers ---
//
// Registered before every /mods/:modId route so that wildcard never takes
// /mods/profiles. The list is the public GET /api/mods/profiles shape
// (every profile with its entries); only an admin writes.

router.get('/mods/profiles', async (_req, res, next) => {
	try {
		res.json(await listPublicProfiles())
	} catch (err) {
		next(err)
	}
})

const PROFILE_SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/

function readProfileFields(body: Record<string, unknown>): ModProfileFields {
	const { name, slug, description } = body
	if (typeof name !== 'string' || !name.trim())
		throw new AppError('name is required', 400)
	if (typeof slug !== 'string' || !PROFILE_SLUG.test(slug))
		throw new AppError(
			'slug is required: lowercase letters, digits and dashes',
			400,
		)
	if (description !== undefined && description !== null && typeof description !== 'string')
		throw new AppError('description must be a string or null', 400)
	return {
		name: name.trim(),
		slug,
		description: description?.trim() || null,
	}
}

function throwSaveProfileError(
	result: Exclude<SaveProfileResult, { ok: true }>,
): never {
	switch (result.reason) {
		case 'not-found':
			throw new AppError('Profile not found', 404)
		case 'slug-taken':
			throw new AppError('Another profile already uses that slug', 409)
	}
}

router.post('/mods/profiles', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const result = await createProfile({
			...readProfileFields(req.body as Record<string, unknown>),
			createdBy: req.player!.playerId,
		})
		if (!result.ok) throwSaveProfileError(result)
		res.status(201).json(result.profile)
	} catch (err) {
		next(err)
	}
})

router.put('/mods/profiles/:id', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const result = await updateProfile(
			req.params.id,
			readProfileFields(req.body as Record<string, unknown>),
		)
		if (!result.ok) throwSaveProfileError(result)
		res.json(result.profile)
	} catch (err) {
		next(err)
	}
})

router.delete('/mods/profiles/:id', async (req, res, next) => {
	try {
		await requireAdmin(req)
		if (!(await deleteProfile(req.params.id)))
			throw new AppError('Profile not found', 404)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// versionMode 'exact' needs a pinnedVersion that is one of the mod's
// versions (name or alias); the other modes ignore pinnedVersion.
router.put('/mods/profiles/:id/entries/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { versionMode, pinnedVersion, allowed } = req.body as {
			versionMode?: unknown
			pinnedVersion?: unknown
			allowed?: unknown
		}
		if (
			typeof versionMode !== 'string' ||
			!modProfileVersionModeEnum.enumValues.includes(
				versionMode as ModProfileVersionMode,
			)
		)
			throw new AppError(
				`versionMode must be one of: ${modProfileVersionModeEnum.enumValues.join(', ')}`,
				400,
			)
		if (versionMode === 'exact' && (typeof pinnedVersion !== 'string' || !pinnedVersion))
			throw new AppError('pinnedVersion is required when versionMode is exact', 400)
		if (allowed !== undefined && typeof allowed !== 'boolean')
			throw new AppError('allowed must be a boolean', 400)

		const result = await setProfileEntry({
			profileId: req.params.id,
			modId: req.params.modId,
			versionMode: versionMode as ModProfileVersionMode,
			pinnedVersion: versionMode === 'exact' ? (pinnedVersion as string) : null,
			allowed: allowed ?? true,
		})
		if (!result.ok) {
			switch (result.reason) {
				case 'profile-not-found':
					throw new AppError('Profile not found', 404)
				case 'mod-not-found':
					throw new AppError('Mod not found', 404)
				case 'version-not-found':
					throw new AppError("That version is not one of this mod's versions", 400)
			}
		}
		res.json(result.entry)
	} catch (err) {
		next(err)
	}
})

router.delete('/mods/profiles/:id/entries/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		if (!(await removeProfileEntry(req.params.id, req.params.modId)))
			throw new AppError('That mod is not in this profile', 404)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Reads the SMODS ids of every pin that has none (pinned before migration
// 0051) from its download -- see smods-ids-backfill.service.ts -- and pushes
// the resulting matchmaking allowlist to Nakama.
router.post('/mods/smods-ids/backfill', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const summary = await backfillSmodsIds()
		const config = await loadConfigFromDb()
		res.json({ ok: true, ...summary, queueAllowedModIds: config.queueAllowedModIds })
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

// The versions the ranked-mods admin UI's version picker offers: the mod's
// merged list (Thunderstore and GitHub versions, each with its source and
// aliases), exactly as GET /api/mods/:id serves it.
router.get('/mods/:id/versions', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const versions = await listVersionsForMod(req.params.id)
		if (!versions) throw new AppError('Mod not found', 404)
		res.json(versions)
	} catch (err) {
		next(err)
	}
})

function throwPinError(result: Exclude<PinCommitResult, { ok: true }>): never {
	switch (result.reason) {
		case 'not-found':
			throw new AppError('Mod not found', 404)
		case 'version-not-found':
			throw new AppError("That version is not one of this mod's versions", 400)
		case 'download-unresolvable':
			throw new AppError(
				"Couldn't resolve that version to a permanent download right now (GitHub unreachable, or the branch/tag is gone) -- try again",
				400,
			)
		case 'no-github-repo':
			throw new AppError(
				"This mod has no github.com repo URL, so a commit can't be pinned",
				400,
			)
		case 'commit-not-found':
			throw new AppError(
				"That commit was not found in the mod's GitHub repo",
				400,
			)
		case 'hash-failed':
			throw new AppError(
				"Couldn't compute a hash for this version -- check the server logs (mod-version-hash) for why the download/extraction failed, then try again",
				400,
			)
	}
}

// Every field is optional; only the ones present are changed.
//  - rankedVersion: null un-ranks the mod; any other value pins it to that
//    version of its merged list (Thunderstore or GitHub, by name or alias).
//  - rankedCommit: pins a GitHub commit by SHA (recorded as a version first).
//  - trackGithub: Thunderstore mods only -- also list the repo's GitHub
//    releases/tags as versions (applied on the next sync).
//  - smodsIds: overrides the SMODS ids a pinned mod reports as (applied
//    after a pin in the same request; a later pin replaces them).
// A pin is resolved to a permanent URL, hashed and its SMODS ids read before
// it's stored -- see mods.gateway.ts's setRankedVersion. A change to a pin or
// its ids changes the matchmaking allowlist, so the config is pushed again.
router.put('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const body = req.body as {
			rankedVersion?: unknown
			rankedCommit?: unknown
			featured?: unknown
			hidden?: unknown
			trackGithub?: unknown
			smodsIds?: unknown
		}
		const { rankedVersion, rankedCommit, featured, hidden, trackGithub } = body
		const smodsIds =
			body.smodsIds === undefined ? undefined : parseSmodsIdsOverride(body.smodsIds)
		if (smodsIds === null) {
			throw new AppError(
				'smodsIds must be a list of SMODS mod ids (no spaces, at most 128 characters each)',
				400,
			)
		}
		if (
			'rankedVersion' in body &&
			rankedVersion !== null &&
			typeof rankedVersion !== 'string'
		) {
			throw new AppError('rankedVersion must be a string or null', 400)
		}
		if (rankedCommit !== undefined && typeof rankedCommit !== 'string') {
			throw new AppError('rankedCommit must be a commit SHA string', 400)
		}
		if ('rankedVersion' in body && rankedCommit !== undefined) {
			throw new AppError('Send rankedVersion or rankedCommit, not both', 400)
		}
		if (featured !== undefined && typeof featured !== 'boolean') {
			throw new AppError('featured must be a boolean', 400)
		}
		if (hidden !== undefined && typeof hidden !== 'boolean') {
			throw new AppError('hidden must be a boolean', 400)
		}
		if (trackGithub !== undefined && typeof trackGithub !== 'boolean') {
			throw new AppError('trackGithub must be a boolean', 400)
		}

		const mod = await findModByIdOrFullName(req.params.modId)
		if (!mod) throw new AppError('Mod not found', 404)
		if (trackGithub !== undefined && mod.isCustom) {
			throw new AppError('A custom mod always tracks GitHub', 400)
		}

		if (featured !== undefined || hidden !== undefined) {
			await setModFlags(mod.id, { featured, hidden })
		}
		if (trackGithub !== undefined) {
			await setTrackGithub(mod.id, trackGithub)
		}

		if ('rankedVersion' in body || rankedCommit !== undefined) {
			const result =
				rankedCommit !== undefined
					? await pinCommit(mod.id, rankedCommit.trim())
					: await setRankedVersion(mod.id, rankedVersion as string | null)
			if (!result.ok) throwPinError(result)
		}
		if (smodsIds !== undefined) {
			const result = await setSmodsIds(mod.id, smodsIds)
			if (!result.ok && result.reason === 'not-found') throw new AppError('Mod not found', 404)
			if (!result.ok) {
				throw new AppError("Only a pinned mod's SMODS ids can be set -- pin a version first", 400)
			}
		}
		if ('rankedVersion' in body || rankedCommit !== undefined || smodsIds !== undefined) {
			await loadConfigFromDb()
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
): Promise<ResolvedSource | null> {
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
				versionDownloadUrl: resolved.versionDownloadUrl,
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
				versionDownloadUrl: resolved.versionDownloadUrl,
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
