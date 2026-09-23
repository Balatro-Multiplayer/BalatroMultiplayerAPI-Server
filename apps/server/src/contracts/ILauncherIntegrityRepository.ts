import type {
	ChallengeKind,
	LauncherIntegrityFailureReason,
} from '../shared/types/index.js'

export interface ILauncherIntegrityRepository {
	insertEvent(
		playerId: string,
		kind: ChallengeKind,
		reason: LauncherIntegrityFailureReason,
	): Promise<void>
}
