import type { Express } from 'express'
import type { RegisterPrivateDeps } from '@bmp/types'

// The real implementation of this hook -- including the launcher-integrity
// ChallengeStrategy (deps.setChallengeStrategy) -- lives in the private
// bet-launcher-integrity-private repo and is checked out over this package at
// VPS deploy time only (never merged into this public monorepo). Running
// without it is expected and safe: launcher-integrity.service.ts treats an
// unset strategy as "feature disabled", not an error -- see that module's
// isEnabled().
export async function registerPrivate(
	_app: Express,
	_deps: RegisterPrivateDeps,
): Promise<void> {
	// Register private routes and services here.
}
