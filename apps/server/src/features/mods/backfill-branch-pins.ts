/**
 * One-off maintenance operation: pins every still-branch-tracked
 * mod_registry_versions row (its downloadUrl still classifies as 'branch' --
 * see mod-source-classifier.ts) to a real, permanently-fetchable
 * commit-specific downloadUrl, and re-downloads + re-hashes each one against
 * that pinned URL -- see resolveCommitPinnedDownloadUrl's doc comment
 * (custom-mod-version-check.service.ts) for why the URL is unfetchable-once-
 * stale in the first place. The hash gets re-verified too, not just the URL:
 * a stale row's stored sha256 was originally computed against whatever the
 * branch's live tip happened to be at hash-time, not necessarily the exact
 * commit its own version label names, so trusting the existing hash could
 * silently leave it mismatched against the commit it's about to claim to be
 * pinned to.
 *
 * Complements pinBranchVersionIfNew() in mods-sync.service.ts, which only
 * ever pins a version the first time it's synced going forward -- this is
 * the one-time catch-up pass for every row that was already synced (and
 * hashed) before that fix existed.
 *
 * A row that fails to resolve/hash after a few retries within this run (a
 * deleted repo/branch, a garbage-collected commit, or a rate limit that
 * outlasts the retries) is marked via pinFailedAt and skipped on future
 * runs, so a known-dead row doesn't keep burning GitHub API calls forever.
 * Pass --retry-failed to also re-attempt rows an earlier run gave up on --
 * useful after whatever made them unresolvable might have changed (a
 * renamed repo, an expired rate limit).
 *
 * Safe to re-run: a row that's already pinned (downloadUrl no longer
 * classifies as 'branch') is left alone, and re-pinning an already-pinned
 * row would just reproduce the same result anyway.
 *
 * Needs the same runtime as the server itself -- network access to every
 * mod's GitHub download URL -- so run it inside the deployed container:
 *
 *   docker compose exec api pnpm --filter balatro-multiplayer-api-server backfill-branch-pins
 *   docker compose exec api pnpm --filter balatro-multiplayer-api-server backfill-branch-pins --retry-failed
 *
 * or locally against a real DATABASE_URL:
 *
 *   tsx --env-file=.env src/features/mods/backfill-branch-pins.ts
 */

import { pool } from '../../infrastructure/db/index.js'
import { runBranchPinBackfill } from './mods-sync.service.js'

const retryFailed = process.argv.includes('--retry-failed')

runBranchPinBackfill({ retryFailed })
	.then(async (summary) => {
		await pool.end()
		console.log(
			`[backfill-branch-pins] Done: ${summary.pinned} pinned, ${summary.alreadyPinned} already pinned, ${summary.failed} newly failed, ${summary.skippedFailed} skipped (already marked failed, pass --retry-failed to retry them).`,
		)
		if (summary.failedRows.length > 0) {
			console.log(
				`[backfill-branch-pins] Rows marked failed this run: ${summary.failedRows
					.map((r) => `${r.modId}@${r.version}`)
					.join(', ')}`,
			)
		}
		process.exit(0)
	})
	.catch(async (err) => {
		console.error('[backfill-branch-pins] Failed:', err)
		await pool.end().catch(() => {})
		process.exit(1)
	})
