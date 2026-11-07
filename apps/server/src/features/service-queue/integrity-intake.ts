// Turns a recorded launcher-integrity failure into an integrity item when
// integrity-flag.ts says it should be one. Called after the failure's event
// row is written (features/nakama/integrity.ts).
import type { LauncherIntegrityFailureReason } from '../../shared/types/index.js'
import { integritySourceId } from '../../shared/service-queue/source-ids.js'
import { decideIntegrityFlag } from './integrity-flag.js'
import type { ItemContext } from './types.js'

export interface IntegrityIntakeDeps {
	// Whether the player is ranked-queued or in a ranked game; null when Nakama
	// could not be asked (then no item is made).
	rankedContext(nakamaUserId: string): Promise<{ queued: boolean; inGame: boolean } | null>
	enqueue(input: {
		itemType: 'integrity'
		sourceId: string
		subjectPlayerId: string
		summary: string
		context: ItemContext
	}): Promise<unknown>
	now(): Date
}

export function createIntegrityIntake(deps: IntegrityIntakeDeps) {
	return {
		async noteFailure(playerId: string, nakamaUserId: string, reason: LauncherIntegrityFailureReason): Promise<void> {
			const now = deps.now()
			const decision = decideIntegrityFlag({ ranked: await deps.rankedContext(nakamaUserId) })
			if (decision.kind === 'none') return
			await deps.enqueue({
				itemType: 'integrity',
				sourceId: integritySourceId(playerId, now),
				subjectPlayerId: playerId,
				summary: `Launcher integrity ${reason} during ranked play`,
				context: { lobbyKind: 'ranked', integrityTrigger: decision.trigger },
			})
		},
	}
}

export type IntegrityIntake = ReturnType<typeof createIntegrityIntake>
