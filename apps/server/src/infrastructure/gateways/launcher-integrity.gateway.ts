import type {
	ChallengeKind,
	LauncherIntegrityFailureReason,
} from '../../shared/types/index.js'
import { db } from '../db/index.js'
import {
	launcherIntegrityEvents,
	playerHardwareFingerprints,
} from '../db/schema.js'

export async function insertEvent(
	playerId: string,
	kind: ChallengeKind,
	reason: LauncherIntegrityFailureReason,
): Promise<void> {
	await db.insert(launcherIntegrityEvents).values({ playerId, kind, reason })
}

// Called only from handleChallengeResponse, and only once a login challenge's
// signature has already verified -- see that module's doc comment. One
// upsert per component so a re-submission (every Ranked Run re-collects and
// re-sends -- see hardwarefingerprint.cpp) refreshes lastSeenAt/componentHash
// in place rather than growing this table unboundedly. Components are
// upserted independently of each other (not a single all-or-nothing batch)
// so a machine that swapped one drive but kept everything else still records
// the parts that didn't change.
export async function upsertHardwareComponents(
	playerId: string,
	platform: string,
	components: Record<string, string>,
): Promise<void> {
	const now = new Date()
	for (const [componentName, componentHash] of Object.entries(components)) {
		await db
			.insert(playerHardwareFingerprints)
			.values({
				playerId,
				platform,
				componentName,
				componentHash,
				firstSeenAt: now,
				lastSeenAt: now,
			})
			.onConflictDoUpdate({
				target: [
					playerHardwareFingerprints.playerId,
					playerHardwareFingerprints.componentName,
				],
				set: {
					platform,
					componentHash,
					lastSeenAt: now,
				},
			})
	}
}
