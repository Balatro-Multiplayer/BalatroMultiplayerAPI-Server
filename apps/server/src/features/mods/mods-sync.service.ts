import { env } from '../../env.js'
import {
	applyDetectedVersion,
	listCustomModsForVersionCheck,
	listGithubTrackedMods,
	listModRowsForClaims,
	listRankedPins,
	mergeGithubVersions,
	pruneModsNotIn,
	resolvePinTarget,
	setRankedPinStatus,
	storeRankedPin,
	writeModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'
import { checkCustomModVersion } from './custom-mod-version-check.service.js'
import { listGithubVersions } from './github-mod-versions.service.js'
import { planModRowClaims } from './mod-registry-claims.js'
import { computeModFolderHashForRelease } from './mod-version-hash.js'
import { checkDownloadAvailable } from './ranked-pin-health.js'
import {
	type ModIndexEntryInput,
	fetchThunderstoreModIndex,
} from './thunderstore-mod-index.service.js'

export interface ModRegistrySyncSummary {
	modsSynced: number
	claimed: number
	pruned: number
	skipped: number
	pinsHashed: number
	pinsUnavailable: number
	customVersionsDetected: number
	githubTrackedMods: number
}

const EMPTY_SUMMARY: ModRegistrySyncSummary = {
	modsSynced: 0,
	claimed: 0,
	pruned: 0,
	skipped: 0,
	pinsHashed: 0,
	pinsUnavailable: 0,
	customVersionsDetected: 0,
	githubTrackedMods: 0,
}

// Custom mods that opted into automaticVersionCheck: asks GitHub whether the
// source moved and records the new version. Best-effort per mod:
// checkCustomModVersion returns null on any GitHub failure, and one mod's
// failure never stops the rest. A ranked pin is untouched either way -- it
// has its own permanent URL.
async function checkCustomModVersions(): Promise<number> {
	let detected = 0
	for (const mod of await listCustomModsForVersionCheck()) {
		try {
			const result = await checkCustomModVersion(mod)
			if (!result) continue
			const applied = await applyDetectedVersion(mod.id, {
				version: result.newVersion,
				downloadUrl: result.newDownloadUrl,
				versionDownloadUrl: result.versionDownloadUrl,
			})
			if (applied) detected++
		} catch (err) {
			console.error(`[mods-sync] Version check failed for ${mod.id}:`, err)
		}
	}
	return detected
}

// Custom mods and Thunderstore mods set to track GitHub: merges the repo's
// releases/tags into the mod's version list. Best-effort per mod.
async function syncGithubVersions(): Promise<number> {
	let merged = 0
	for (const mod of await listGithubTrackedMods()) {
		try {
			const versions = await listGithubVersions(
				mod.repoUrl,
				mod.latestDownloadUrl,
			)
			if (!versions) continue
			await mergeGithubVersions(mod.id, mod.thunderstoreFullName, versions)
			merged++
		} catch (err) {
			console.error(`[mods-sync] GitHub versions failed for ${mod.id}:`, err)
		}
	}
	return merged
}

// Pins are only ever changed by an admin. The sync:
//  - resolves and hashes a pin that has no permanent URL yet (carried over
//    from before migration 0045, which also re-hashes Thunderstore pins as
//    shipped rather than flattened) -- the old hash keeps being served until
//    the new one is stored;
//  - otherwise checks the pinned download still exists and sets
//    rankedDownloadStatus, never clearing or re-pointing the pin.
async function reconcileRankedPins(
	entries: ModIndexEntryInput[],
): Promise<{ hashed: number; unavailable: number }> {
	const tsVersions = new Map(
		entries.map((e) => [e.fullName, new Set(e.versions.map((v) => v.version))]),
	)
	let hashed = 0
	let unavailable = 0

	for (const pin of await listRankedPins()) {
		const version = pin.rankedVersion!
		try {
			if (!pin.rankedDownloadUrl || !pin.rankedVersionSha256) {
				const target = await resolvePinTarget(pin.id, pin.repoUrl, version)
				const hash = target?.downloadUrl
					? await computeModFolderHashForRelease(
							pin.id,
							target.version,
							target.downloadUrl,
							target.source,
						)
					: null
				if (target?.downloadUrl && hash) {
					await storeRankedPin(
						pin.id,
						{
							version: target.version,
							downloadUrl: target.downloadUrl,
							source: target.source,
							hash,
						},
						version,
					)
					hashed++
				} else {
					await setRankedPinStatus(pin.id, version, 'unavailable')
					unavailable++
					console.warn(
						`[mods-sync] Ranked pin ${pin.id}@${version} has no resolvable download -- flagged for an admin`,
					)
				}
				continue
			}

			// A Thunderstore pin whose version is still listed is known-good
			// without a request; anything else gets a HEAD check.
			const listed =
				pin.rankedSource === 'thunderstore' &&
				!!pin.thunderstoreFullName &&
				!!tsVersions.get(pin.thunderstoreFullName)?.has(version)
			const status = listed
				? 'ok'
				: await checkDownloadAvailable(pin.rankedDownloadUrl)
			if (status && status !== pin.rankedDownloadStatus) {
				await setRankedPinStatus(pin.id, version, status)
			}
			if (status === 'unavailable') {
				unavailable++
				console.warn(
					`[mods-sync] Ranked pin ${pin.id}@${version}: download is gone -- flagged for an admin`,
				)
			}
		} catch (err) {
			console.error(`[mods-sync] Ranked pin check failed for ${pin.id}:`, err)
		}
	}

	return { hashed, unavailable }
}

// Pulls thunderstore.io/c/balatro (see thunderstore-mod-index.service.ts),
// writes each package into the row planModRowClaims picks for it, prunes
// every row this run didn't write, merges GitHub versions, then checks
// ranked pins. A failed Thunderstore fetch throws before anything is written
// or pruned.
async function runSync(): Promise<ModRegistrySyncSummary> {
	if (!env.MOD_INDEX_SYNC_ENABLED) {
		console.log(
			'[mods-sync] MOD_INDEX_SYNC_ENABLED is false -- skipping mod registry sync',
		)
		return EMPTY_SUMMARY
	}

	// Custom-mod checks run first and independently: a Thunderstore outage
	// throws below, and must not also stall a custom mod's own source.
	const customDetected = await checkCustomModVersions()

	const { entries, skipped: skippedByFilter } =
		await fetchThunderstoreModIndex()

	const claims = planModRowClaims(entries, await listModRowsForClaims())
	let claimed = 0
	let skippedByCustomId = 0
	for (const entry of entries) {
		const claim = claims.get(entry.fullName)!
		if (claim.kind === 'skip') {
			skippedByCustomId++
			console.warn(
				`[mods-sync] Skipping Thunderstore package ${entry.fullName}: its id is an admin-created custom mod`,
			)
			continue
		}
		if (claim.kind === 'claimed') claimed++
		await writeModFromIndex(claim, entry)
	}
	const skipped = skippedByFilter + skippedByCustomId

	const pruned = await pruneModsNotIn(entries.map((e) => e.fullName))
	const githubTrackedMods = await syncGithubVersions()
	const pins = await reconcileRankedPins(entries)

	console.log(
		`[mods-sync] Synced ${entries.length} mods from thunderstore` +
			(claimed ? ` (${claimed} carried-over rows claimed)` : '') +
			(pruned ? ` (${pruned} stale mods pruned)` : '') +
			(skipped ? ` (${skipped} skipped)` : '') +
			(githubTrackedMods ? ` (${githubTrackedMods} GitHub-tracked mods)` : '') +
			(pins.hashed ? ` (${pins.hashed} ranked pins hashed)` : '') +
			(pins.unavailable
				? ` (${pins.unavailable} ranked pins unavailable)`
				: '') +
			(customDetected
				? ` (${customDetected} custom mod versions detected)`
				: ''),
	)

	return {
		modsSynced: entries.length,
		claimed,
		pruned,
		skipped,
		pinsHashed: pins.hashed,
		pinsUnavailable: pins.unavailable,
		customVersionsDetected: customDetected,
		githubTrackedMods,
	}
}

// Runs at server startup (in the background, see main.ts), then on an hourly
// interval, and on demand from the admin "Sync now" button
// (POST /api/webadmin/mods/sync). Those callers can overlap in time, so a
// second call while one is already running just awaits the in-flight run's
// result instead of kicking off a redundant concurrent pass.
let inFlight: Promise<ModRegistrySyncSummary> | null = null

export function syncModRegistry(): Promise<ModRegistrySyncSummary> {
	if (!inFlight) {
		inFlight = runSync().finally(() => {
			inFlight = null
		})
	}
	return inFlight
}
