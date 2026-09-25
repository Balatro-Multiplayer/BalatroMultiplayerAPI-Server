import { env } from '../../env.js'
import {
	applyDetectedVersion,
	clearRankedPin,
	getCustomPinDownloadUrl,
	listCustomModsForVersionCheck,
	listModRowsForClaims,
	listRankedPins,
	pruneModsNotIn,
	storeRankedPinHash,
	writeModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'
import { checkCustomModVersion } from './custom-mod-version-check.service.js'
import { planModRowClaims } from './mod-registry-claims.js'
import { computeModFolderHashForRelease } from './mod-version-hash.js'
import {
	type ModIndexEntryInput,
	fetchThunderstoreModIndex,
} from './thunderstore-mod-index.service.js'

export interface ModRegistrySyncSummary {
	modsSynced: number
	claimed: number
	pruned: number
	skipped: number
	pinsCleared: number
	pinsHashed: number
	customVersionsDetected: number
}

const EMPTY_SUMMARY: ModRegistrySyncSummary = {
	modsSynced: 0,
	claimed: 0,
	pruned: 0,
	skipped: 0,
	pinsCleared: 0,
	pinsHashed: 0,
	customVersionsDetected: 0,
}

// Custom mods that opted into automaticVersionCheck: asks GitHub whether the
// source moved, and records the new version (dropping a ranked pin the new
// state can no longer back -- see applyDetectedVersion). Best-effort per
// mod: checkCustomModVersion returns null on any GitHub failure, and one
// mod's failure never stops the rest.
async function checkCustomModVersions(): Promise<{
	detected: number
	pinsCleared: number
}> {
	let detected = 0
	let pinsCleared = 0
	for (const mod of await listCustomModsForVersionCheck()) {
		try {
			const result = await checkCustomModVersion(mod)
			if (!result) continue
			const { pinCleared } = await applyDetectedVersion(mod.id, {
				version: result.newVersion,
				downloadUrl: result.newDownloadUrl,
			})
			detected++
			if (pinCleared) {
				pinsCleared++
				console.warn(
					`[mods-sync] Cleared ranked pin on custom mod ${mod.id}: version moved to ${result.newVersion}`,
				)
			}
		} catch (err) {
			console.error(`[mods-sync] Version check failed for ${mod.id}:`, err)
		}
	}
	return { detected, pinsCleared }
}

// Keeps every ranked pin consistent with its source: a Thunderstore pin
// whose version Thunderstore no longer serves is cleared (it can't be
// installed, so it can't be verified), and a pin with no hash yet -- carried
// over from the GitHub-index era, or whose hash failed at pin time -- is
// hashed now. A custom mod's pin is judged against its own stored version
// rows instead (custom mods never appear in the Thunderstore list); its
// staleness is handled when its version moves (applyDetectedVersion /
// updateCustomMod), so here it is only ever hashed, never cleared for being
// "not on Thunderstore". A failed hash leaves the pin unhashed for the next
// sync to retry; an unhashed pin fails the launcher's Ranked check rather
// than passing it.
async function reconcileRankedPins(
	entries: ModIndexEntryInput[],
): Promise<{ cleared: number; hashed: number }> {
	const byFullName = new Map(entries.map((e) => [e.fullName, e]))
	let cleared = 0
	let hashed = 0

	for (const pin of await listRankedPins()) {
		const version = pin.rankedVersion!
		if (pin.isCustom) {
			if (pin.rankedVersionSha256) continue
			const downloadUrl = await getCustomPinDownloadUrl(pin.id, version)
			if (!downloadUrl) {
				await clearRankedPin(pin.id, version)
				cleared++
				console.warn(
					`[mods-sync] Cleared ranked pin ${pin.id}@${version}: no downloadable version row`,
				)
				continue
			}
			const hash = await computeModFolderHashForRelease(
				pin.id,
				version,
				downloadUrl,
			)
			if (hash) {
				await storeRankedPinHash(pin.id, version, hash)
				hashed++
			}
			continue
		}
		const entry = pin.thunderstoreFullName
			? byFullName.get(pin.thunderstoreFullName)
			: undefined
		const release = entry?.versions.find((v) => v.version === version)
		if (!release) {
			await clearRankedPin(pin.id, version)
			cleared++
			console.warn(
				`[mods-sync] Cleared ranked pin ${pin.id}@${version}: not on Thunderstore`,
			)
			continue
		}
		if (pin.rankedVersionSha256) continue

		const hash = await computeModFolderHashForRelease(
			pin.id,
			version,
			release.downloadUrl,
		)
		if (hash) {
			await storeRankedPinHash(pin.id, version, hash)
			hashed++
		}
	}

	return { cleared, hashed }
}

// Pulls thunderstore.io/c/balatro (see thunderstore-mod-index.service.ts),
// writes each package into the row planModRowClaims picks for it, prunes
// every row this run didn't write, then reconciles ranked pins. A failed
// fetch throws before anything is written or pruned.
async function runSync(): Promise<ModRegistrySyncSummary> {
	if (!env.MOD_INDEX_SYNC_ENABLED) {
		console.log(
			'[mods-sync] MOD_INDEX_SYNC_ENABLED is false -- skipping mod registry sync',
		)
		return EMPTY_SUMMARY
	}

	// Custom-mod checks run first and independently: a Thunderstore outage
	// throws below, and must not also stall a custom mod's own source.
	const custom = await checkCustomModVersions()

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
	const pins = await reconcileRankedPins(entries)

	console.log(
		`[mods-sync] Synced ${entries.length} mods from thunderstore` +
			(claimed ? ` (${claimed} carried-over rows claimed)` : '') +
			(pruned ? ` (${pruned} stale mods pruned)` : '') +
			(skipped ? ` (${skipped} skipped)` : '') +
			(pins.cleared + custom.pinsCleared
				? ` (${pins.cleared + custom.pinsCleared} ranked pins cleared)`
				: '') +
			(pins.hashed ? ` (${pins.hashed} ranked pins hashed)` : '') +
			(custom.detected
				? ` (${custom.detected} custom mod versions detected)`
				: ''),
	)

	return {
		modsSynced: entries.length,
		claimed,
		pruned,
		skipped,
		pinsCleared: pins.cleared + custom.pinsCleared,
		pinsHashed: pins.hashed,
		customVersionsDetected: custom.detected,
	}
}

// Runs once, blocking, at server startup (see main.ts) so the mod catalog is
// already correct before the server accepts its first request -- then again
// on an hourly interval in the background, and on demand from the admin
// "Sync now" button (POST /api/webadmin/mods/sync). Those three callers can
// easily overlap in time (an admin clicking the button right as the hourly
// interval fires, or clicking it twice), so a second call while one is
// already running just awaits the in-flight run's result instead of kicking
// off a redundant concurrent pass.
let inFlight: Promise<ModRegistrySyncSummary> | null = null

export function syncModRegistry(): Promise<ModRegistrySyncSummary> {
	if (!inFlight) {
		inFlight = runSync().finally(() => {
			inFlight = null
		})
	}
	return inFlight
}
