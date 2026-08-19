import type { ChallengeIssuance, ChallengeKind } from '../shared/types/index.js'

export interface IntegrityChallenge {
	challengeId: string
	kind: ChallengeKind
	issuance: ChallengeIssuance
	timeoutTimer: ReturnType<typeof setTimeout>
}

export interface IntegritySession {
	playerId: string
	launcherVerified: boolean
	// Set on any challenge failure (refused/wrong/timeout), login or periodic
	// -- session-scoped, so it clears on the next fresh login
	// (handleClientConnected always starts from a fresh session). Currently
	// write-only (no consumer reads it yet); kept for audit/debugging value.
	launcherRefused: boolean
	activeChallenge?: IntegrityChallenge
	nextChallengeTimer?: ReturnType<typeof setTimeout>
}

export const integritySessions = new Map<string, IntegritySession>()
