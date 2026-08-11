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

	// Called only from handleChallengeResponse, and only once a login
	// challenge's signature has already verified -- see that module's doc
	// comment on the current (pre-hwid-binding) trust caveat.
	upsertHardwareComponents(
		playerId: string,
		platform: string,
		components: Record<string, string>,
	): Promise<void>
}
