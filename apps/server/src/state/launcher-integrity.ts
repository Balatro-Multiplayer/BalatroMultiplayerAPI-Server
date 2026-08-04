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
	// Set once the login challenge is refused/failed/timed out without ever
	// having passed -- session-scoped, so it clears on the next fresh login
	// (handleClientConnected always starts from a fresh session).
	launcherRefused: boolean
	activeChallenge?: IntegrityChallenge
	nextChallengeTimer?: ReturnType<typeof setTimeout>
}

export const integritySessions = new Map<string, IntegritySession>()
