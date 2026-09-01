import { Router } from 'express'
import { modProfileVersionModeEnum } from '../../infrastructure/db/schema.js'
import {
	createCustomMod,
	createProfile,
	deleteCustomMod,
	deleteProfile,
	getProfileById,
	getPublicModById,
	getStoredHash,
	listProfiles,
	listPublicMods,
	removeProfileEntry,
	resetModFieldOverrides,
	setFeatured,
	setHidden,
	setRankedVersion,
	updateCustomMod,
	updateModFields,
	updateProfile,
	upsertProfileEntry,
} from '../../infrastructure/gateways/mods.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import {
	type SourceInput,
	resolveSourceInput,
} from '../mods/custom-mod-version-check.service.js'
import { classifyDownloadUrl } from '../mods/mod-source-classifier.js'
import { ensureVersionHashed, syncModRegistry } from '../mods/mods-sync.service.js'

// Validates+resolves an admin-supplied `sourceInput` (see mod-form-dialog.tsx
// and custom-mod-version-check.service.ts's resolveSourceInput doc comment)
// into the flat fields updateModFields()/createCustomMod() already expect -
// shared by POST /mods and PATCH /mods/:modId below. Only 'branch'/'release'
// are ever expected here - 'custom' mode sends latestDownloadUrl directly
// instead (there's nothing to resolve for an arbitrary URL), so this throws
// on anything else rather than silently accepting it.
async function resolveSourceInputField(body: Record<string, unknown>): Promise<{
	latestDownloadUrl: string
	latestVersion: string | null
} | null> {
	if (body.sourceInput === undefined) return null
	const si = body.sourceInput as Record<string, unknown>

	if (si.sourceType === 'branch') {
		if (typeof si.repoUrl !== 'string' || !si.repoUrl) {
			throw new AppError('sourceInput.repoUrl is required for branch', 400)
		}
		if (typeof si.branch !== 'string' || !si.branch) {
			throw new AppError('sourceInput.branch is required for branch', 400)
		}
		const input: SourceInput = {
			sourceType: 'branch',
			repoUrl: si.repoUrl,
			branch: si.branch,
		}
		return resolveSourceInput(input)
	}

	if (si.sourceType === 'release') {
		if (typeof si.repoUrl !== 'string' || !si.repoUrl) {
			throw new AppError('sourceInput.repoUrl is required for release', 400)
		}
		const input: SourceInput = { sourceType: 'release', repoUrl: si.repoUrl }
		return resolveSourceInput(input)
	}

	throw new AppError(
		"sourceInput.sourceType must be 'branch' or 'release'",
		400,
	)
}

// Ranked mod catalog admin surface: manual per-mod ranked-allowlist overrides
// and named "ranked mod profiles" (admin-curated allowed/blocked mod lists,
// requested so admins can compose ranked eligibility on the site). Info-only
// for now -- nothing cross-checks a client's actual installed mods against a
// profile at queue time yet (see the design plan's ranked-mod-enforcement
// note, deliberately deferred); this is the data the launcher/website read.
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

// Admin-only mirror of the public GET /api/mods (see features/mods/
// mods.route.ts) that includes hidden mods -- the /admin/ranked-mods page
// reads from this instead of the public route so a hidden mod stays
// visible/manageable there (see mods.gateway.ts's listPublicMods
// includeHidden doc comment). No wildcard-vs-/mods/profiles ordering risk
// here since this is an exact path, unlike GET /mods/:modId below.
router.get('/mods', async (_req, res, next) => {
	try {
		res.json(await listPublicMods({ includeHidden: true }))
	} catch (err) {
		next(err)
	}
})

// Manually kicks off the same upstream sync + prepared-archive hashing pass
// that otherwise only runs at server startup and on the hourly interval (see
// mods-sync.service.ts) -- e.g. to confirm a mod's hash updated right after a
// new release, without waiting for the next tick or restarting the server.
// syncModRegistry() itself dedupes concurrent calls (an in-flight run is
// shared, not duplicated), so this is safe to hit even if the hourly job is
// mid-run. Admin-only: this downloads and hashes every mod's archive, a
// heavier blast radius than the per-mod toggle above.
router.post('/mods/sync', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const summary = await syncModRegistry()
		res.json({ ok: true, ...summary })
	} catch (err) {
		next(err)
	}
})

// rankedVersion, featured, and hidden are all entirely admin-owned -- see
// mods.gateway.ts's setRankedVersion/setFeatured/setHidden doc comments. At
// least one of the three fields must be present; any can be sent alone to
// update just that one.
//
// A non-null rankedVersion is the sole ranked-eligibility signal now (see
// schema.ts's rankedVersion doc comment) -- validated here, not in the
// gateway, since it needs the mod's current latestDownloadUrl/latestVersion
// and known mod_registry_versions, which this handler already has to fetch
// anyway to 404 on an unknown modId before touching anything else:
//   - sourceType 'custom' (mod-source-classifier.ts) -> always rejected,
//     nothing to pin against reliably.
//   - sourceType 'branch' -> only the mod's own current latestVersion is
//     accepted (a branch archive URL always re-resolves to current HEAD,
//     so an older value could never actually be re-fetched).
//   - sourceType 'release' -> any version that actually appears in the
//     mod's mod_registry_versions history is accepted.
router.put('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { rankedVersion, featured, hidden } = req.body as {
			rankedVersion?: unknown
			featured?: unknown
			hidden?: unknown
		}
		if (
			rankedVersion !== undefined &&
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
		if (
			rankedVersion === undefined &&
			featured === undefined &&
			hidden === undefined
		) {
			throw new AppError('rankedVersion, featured, or hidden is required', 400)
		}
		if (rankedVersion !== undefined) {
			if (rankedVersion !== null) {
				const mod = await getPublicModById(req.params.modId, {
					includeHidden: true,
				})
				if (!mod) throw new AppError('Mod not found', 404)
				const sourceType = classifyDownloadUrl(mod.latestDownloadUrl ?? '')
				if (sourceType === 'custom') {
					throw new AppError(
						"Custom-hosted mods can't be ranked-allowed -- their source can't be reliably re-fetched or verified",
						400,
					)
				}
				if (sourceType === 'branch' && rankedVersion !== mod.latestVersion) {
					throw new AppError(
						'Branch-tracked mods can only be pinned to their current version',
						400,
					)
				}
				if (
					sourceType === 'release' &&
					!mod.versions.some((v) => v.version === rankedVersion)
				) {
					// Recovery path, not the normal case: the mod's own current
					// latestVersion should always be a legal ranked pin, even if
					// it has no mod_registry_versions row/hash yet. That gap
					// normally closes itself right after a Branch/Release source
					// edit (see ensureVersionHashed()'s own comment) - but the
					// admin UI's PATCH is diff-based, only resending sourceInput
					// when something in it actually changed, so an admin who
					// already saved the right source once (and is now just stuck
					// with an unhashed version - see Blueprint's real-world case)
					// has no way to re-trigger that from the edit dialog alone.
					// Retry hashing right now, once, for exactly this one
					// recoverable case - mod.latestDownloadUrl is already known-
					// correct for mod.latestVersion, there's nothing to resolve,
					// only to (re)compute.
					if (rankedVersion === mod.latestVersion && mod.latestDownloadUrl) {
						await ensureVersionHashed(
							req.params.modId,
							rankedVersion,
							mod.latestDownloadUrl,
						)
					}
					const stillUnknown = !(await getStoredHash(req.params.modId, rankedVersion))
					if (stillUnknown) {
						throw new AppError(
							rankedVersion === mod.latestVersion
								? "Couldn't compute a hash for this mod's current version - check the server logs (mods-sync) for why the download/extraction failed, then try again"
								: 'Not a known version of this mod',
							400,
						)
					}
				}
			}
			const ok = await setRankedVersion(req.params.modId, rankedVersion)
			if (!ok) throw new AppError('Mod not found', 404)
		}
		if (featured !== undefined) {
			const ok = await setFeatured(req.params.modId, featured)
			if (!ok) throw new AppError('Mod not found', 404)
		}
		if (hidden !== undefined) {
			const ok = await setHidden(req.params.modId, hidden)
			if (!ok) throw new AppError('Mod not found', 404)
		}
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Edits any of the SYNCABLE_MOD_FIELDS (title/author/categories/etc.) on any
// mod -- custom or index-synced. On an index-synced mod, every field sent
// here is folded into that row's overriddenFields so future syncs leave it
// alone (see mods.gateway.ts's updateModFields doc comment); a custom mod
// just gets a plain write. Body shape mirrors POST /mods below minus `id`
// (immutable) -- every field is optional, only the ones present are touched.
router.patch('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const body = req.body as Record<string, unknown>
		const input: Parameters<typeof updateModFields>[1] = {}

		if (body.title !== undefined) {
			if (typeof body.title !== 'string' || !body.title)
				throw new AppError('title must be a non-empty string', 400)
			input.title = body.title
		}
		if (body.author !== undefined) {
			if (typeof body.author !== 'string' || !body.author)
				throw new AppError('author must be a non-empty string', 400)
			input.author = body.author
		}
		if (body.categories !== undefined) {
			if (
				!Array.isArray(body.categories) ||
				!body.categories.every((c) => typeof c === 'string')
			) {
				throw new AppError('categories must be a string array', 400)
			}
			input.categories = body.categories as string[]
		}
		if (body.searchTerms !== undefined) {
			if (
				!Array.isArray(body.searchTerms) ||
				!body.searchTerms.every((t) => typeof t === 'string')
			) {
				throw new AppError('searchTerms must be a string array', 400)
			}
			input.searchTerms = body.searchTerms as string[]
		}
		if (body.requiresSteamodded !== undefined) {
			if (typeof body.requiresSteamodded !== 'boolean')
				throw new AppError('requiresSteamodded must be a boolean', 400)
			input.requiresSteamodded = body.requiresSteamodded
		}
		if (body.requiresTalisman !== undefined) {
			if (typeof body.requiresTalisman !== 'boolean')
				throw new AppError('requiresTalisman must be a boolean', 400)
			input.requiresTalisman = body.requiresTalisman
		}
		for (const key of [
			'repoUrl',
			'thumbnailUrl',
			'description',
			'latestVersion',
			'latestDownloadUrl',
		] as const) {
			if (body[key] === undefined) continue
			if (body[key] !== null && typeof body[key] !== 'string') {
				throw new AppError(`${key} must be a string or null`, 400)
			}
			input[key] = body[key] as string | null
		}

		// Branch/Release mode: resolves latestDownloadUrl/latestVersion from
		// repoUrl (+ branch name, for Branch) instead of the admin typing a
		// raw URL - see resolveSourceInputField's own comment. Takes priority
		// over any latestVersion/latestDownloadUrl the body also happened to
		// send directly (the client only ever sends one or the other).
		// automaticVersionCheck isn't touched here - it's isCustom-only
		// (ignored for a synced mod, see schema.ts's own doc comment) and
		// updateModFields doesn't write it at all; the admin's existing
		// toggle (PUT /mods/:modId/custom, isCustom rows only) is untouched
		// by this.
		const resolved = await resolveSourceInputField(body)
		if (resolved) {
			input.latestDownloadUrl = resolved.latestDownloadUrl
			input.latestVersion = resolved.latestVersion
		}

		if (Object.keys(input).length === 0) {
			throw new AppError('At least one field is required', 400)
		}

		const mod = await updateModFields(req.params.modId, input)
		if (!mod) throw new AppError('Mod not found', 404)

		// See ensureVersionHashed()'s own comment for why this can't be left
		// to the regular sync - an admin-resolved Branch/Release version has
		// no other path to ever get a mod_registry_versions row or a hash at
		// all otherwise. Only meaningful when resolved actually ran (Branch/
		// Release mode) and produced a real version to hash - a 'branch' mod
		// with an unreachable ref already threw out of resolveSourceInputField
		// above, and Custom mode never reaches here since resolved stays null.
		if (resolved?.latestVersion) {
			await ensureVersionHashed(
				req.params.modId,
				resolved.latestVersion,
				resolved.latestDownloadUrl,
			)
		}

		res.json(mod)
	} catch (err) {
		next(err)
	}
})

// Un-pins the given fields (or every overridden field, if `fields` is
// omitted) so the next sync restores their upstream value -- see
// mods.gateway.ts's resetModFieldOverrides doc comment.
router.post('/mods/:modId/reset-overrides', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { fields } = req.body as { fields?: unknown }
		if (
			fields !== undefined &&
			(!Array.isArray(fields) || !fields.every((f) => typeof f === 'string'))
		) {
			throw new AppError('fields must be a string array', 400)
		}
		const ok = await resetModFieldOverrides(
			req.params.modId,
			fields as string[] | undefined,
		)
		if (!ok) throw new AppError('Mod not found', 404)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Clears this mod's ranked config back to the defaults (not allowed, no
// version pin).
router.delete('/mods/:modId/ranked', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const ok = await setRankedVersion(req.params.modId, null)
		if (!ok) throw new AppError('Mod not found', 404)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Creates a mod entry with no base-index counterpart at all (an id BETModIndex
// will never publish) -- e.g. a partner mod not listed upstream. Folded into
// the same hashing pass as index-synced mods (see mods-sync.service.ts).
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

		// Branch/Release mode: resolves latestDownloadUrl/latestVersion from
		// repoUrl (+ branch name, for Branch) instead of the admin typing a
		// raw URL - see resolveSourceInputField's own comment. Every mod this
		// route creates is isCustom=true by definition, so (unlike the PATCH
		// route below, which also edits synced mods) automaticVersionCheck is
		// always meaningful here - force it on so a Branch/Release mod keeps
		// tracking its source without the admin needing to separately opt in.
		const resolved = await resolveSourceInputField(body)

		const mod = await createCustomMod({
			id,
			title,
			author,
			categories: Array.isArray(body.categories)
				? (body.categories as string[])
				: undefined,
			searchTerms: Array.isArray(body.searchTerms)
				? (body.searchTerms as string[])
				: undefined,
			requiresSteamodded:
				typeof body.requiresSteamodded === 'boolean'
					? body.requiresSteamodded
					: undefined,
			requiresTalisman:
				typeof body.requiresTalisman === 'boolean'
					? body.requiresTalisman
					: undefined,
			repoUrl: typeof body.repoUrl === 'string' ? body.repoUrl : null,
			thumbnailUrl:
				typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl : null,
			description:
				typeof body.description === 'string' ? body.description : null,
			latestVersion:
				resolved?.latestVersion ??
				(typeof body.latestVersion === 'string' ? body.latestVersion : null),
			latestDownloadUrl:
				resolved?.latestDownloadUrl ??
				(typeof body.latestDownloadUrl === 'string'
					? body.latestDownloadUrl
					: null),
			automaticVersionCheck:
				resolved !== null
					? true
					: typeof body.automaticVersionCheck === 'boolean'
						? body.automaticVersionCheck
						: undefined,
			fixedReleaseTagUpdates:
				typeof body.fixedReleaseTagUpdates === 'boolean'
					? body.fixedReleaseTagUpdates
					: undefined,
		})
		if (!mod) throw new AppError(`A mod with id '${id}' already exists`, 409)

		// See ensureVersionHashed()'s own comment. automaticVersionCheck being
		// forced on above means the *next* sync would eventually reach this
		// version too (via checkCustomModVersion() re-detecting the same
		// value as "no change" and moving on to hashing it) - but that could
		// be up to an hour away, and only re-detects successfully if nothing
		// about the repo changed out from under it in the meantime. Hashing
		// it immediately here instead means a freshly created Branch/Release
		// mod is actually ranked-pinnable right away, not just eventually.
		if (resolved?.latestVersion) {
			await ensureVersionHashed(id, resolved.latestVersion, resolved.latestDownloadUrl)
		}

		res.status(201).json(mod)
	} catch (err) {
		next(err)
	}
})

// Edits an existing custom mod's own fields -- distinct from
// PUT /mods/:modId above, which only ever touches ranked config. Only
// isCustom rows are editable this way; a synced mod's fields come from the
// index and would just be overwritten on the next sync anyway. Every field
// is optional (a partial update), unlike POST /mods's required id/title/author.
router.put('/mods/:modId/custom', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const body = req.body as Record<string, unknown>

		const str = (key: string): string | undefined =>
			typeof body[key] === 'string' ? (body[key] as string) : undefined
		const strOrNull = (key: string): string | null | undefined =>
			body[key] === null ? null : str(key)
		const bool = (key: string): boolean | undefined =>
			typeof body[key] === 'boolean' ? (body[key] as boolean) : undefined

		const mod = await updateCustomMod(req.params.modId, {
			title: str('title'),
			author: str('author'),
			categories: Array.isArray(body.categories)
				? (body.categories as string[])
				: undefined,
			searchTerms: Array.isArray(body.searchTerms)
				? (body.searchTerms as string[])
				: undefined,
			requiresSteamodded: bool('requiresSteamodded'),
			requiresTalisman: bool('requiresTalisman'),
			repoUrl: strOrNull('repoUrl'),
			thumbnailUrl: strOrNull('thumbnailUrl'),
			description: strOrNull('description'),
			latestVersion: strOrNull('latestVersion'),
			latestDownloadUrl: strOrNull('latestDownloadUrl'),
			automaticVersionCheck: bool('automaticVersionCheck'),
			fixedReleaseTagUpdates: bool('fixedReleaseTagUpdates'),
		})
		if (!mod) throw new AppError('Custom mod not found', 404)
		res.json(mod)
	} catch (err) {
		next(err)
	}
})

// Only a custom mod (no base-index counterpart) can be deleted here -- a
// synced mod would just reappear on the next sync, so deleting it isn't
// meaningful.
router.delete('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const mod = await getPublicModById(req.params.modId, {
			includeHidden: true,
		})
		if (!mod) throw new AppError('Mod not found', 404)
		if (!mod.isCustom) {
			throw new AppError(
				'Only a custom mod can be deleted -- a synced mod would just reappear on the next sync',
				400,
			)
		}
		await deleteCustomMod(req.params.modId)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

router.get('/mods/profiles', async (_req, res, next) => {
	try {
		res.json(await listProfiles())
	} catch (err) {
		next(err)
	}
})

router.get('/mods/profiles/:id', async (req, res, next) => {
	try {
		const profile = await getProfileById(req.params.id)
		if (!profile) throw new AppError('Profile not found', 404)
		res.json(profile)
	} catch (err) {
		next(err)
	}
})

// Admin-only mirror of the public GET /api/mods/:id that includes hidden
// mods (see the GET /mods comment above). Registered after /mods/profiles
// and /mods/profiles/:id on purpose -- same reasoning as the public
// router's own comment: this wildcard would otherwise swallow those static
// paths since they share the GET method.
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

router.post('/mods/profiles', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { name, slug, description } = req.body as {
			name?: unknown
			slug?: unknown
			description?: unknown
		}
		if (typeof name !== 'string' || !name)
			throw new AppError('name is required', 400)
		if (typeof slug !== 'string' || !slug)
			throw new AppError('slug is required', 400)

		const profile = await createProfile({
			name,
			slug,
			description: typeof description === 'string' ? description : null,
			createdBy: req.player!.playerId,
		})
		res.status(201).json(profile)
	} catch (err) {
		next(err)
	}
})

router.put('/mods/profiles/:id', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { name, slug, description } = req.body as {
			name?: unknown
			slug?: unknown
			description?: unknown
		}
		if (typeof name !== 'string' || !name)
			throw new AppError('name is required', 400)
		if (typeof slug !== 'string' || !slug)
			throw new AppError('slug is required', 400)

		const profile = await updateProfile(req.params.id, {
			name,
			slug,
			description: typeof description === 'string' ? description : null,
		})
		if (!profile) throw new AppError('Profile not found', 404)
		res.json(profile)
	} catch (err) {
		next(err)
	}
})

router.delete('/mods/profiles/:id', async (req, res, next) => {
	try {
		await requireAdmin(req)
		await deleteProfile(req.params.id)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

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
				versionMode as (typeof modProfileVersionModeEnum.enumValues)[number],
			)
		)
			throw new AppError(
				`versionMode must be one of: ${modProfileVersionModeEnum.enumValues.join(', ')}`,
				400,
			)
		if (versionMode === 'exact' && typeof pinnedVersion !== 'string')
			throw new AppError(
				'pinnedVersion is required when versionMode is exact',
				400,
			)

		const entry = await upsertProfileEntry({
			profileId: req.params.id,
			modId: req.params.modId,
			versionMode:
				versionMode as (typeof modProfileVersionModeEnum.enumValues)[number],
			pinnedVersion: versionMode === 'exact' ? (pinnedVersion as string) : null,
			allowed: typeof allowed === 'boolean' ? allowed : true,
		})
		res.json(entry)
	} catch (err) {
		next(err)
	}
})

router.delete('/mods/profiles/:id/entries/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		await removeProfileEntry(req.params.id, req.params.modId)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
