/**
 * Recomputes every mod_registry_versions row's sha256 under the corrected
 * "prepared zip" algorithm (see mods-sync.service.ts's
 * computePreparedZipHash doc comment) -- every hash stored before that
 * rewrite was computed over the raw GitHub download, which
 * RunController::currentZipMatchesServerHash() (new-launcher) never
 * actually verifies against.
 *
 * One-time maintenance operation, not part of the regular hourly/startup
 * sync -- run it explicitly, once, after deploying the prepared-zip-hash
 * rewrite. Safe to re-run: recomputing an already-correct hash just
 * produces the same value again.
 *
 * Needs the same runtime as the server itself -- the modzip binary on
 * PATH (only present in the built Docker image, see Dockerfile) and
 * network access to every mod's GitHub download URL -- so run it inside
 * the deployed container, e.g.:
 *
 *   docker compose exec api pnpm --filter balatro-multiplayer-api-server backfill-mod-hashes
 *
 * or locally against a real DATABASE_URL if you have modzip built and on
 * PATH some other way:
 *
 *   tsx --env-file=.env src/features/mods/backfill-mod-hashes.ts
 */

import { pool } from '../../infrastructure/db/index.js'
import { recomputeAllModHashes } from './mods-sync.service.js'

recomputeAllModHashes()
	.then(async () => {
		await pool.end()
		console.log('[backfill-mod-hashes] Done.')
		process.exit(0)
	})
	.catch(async (err) => {
		console.error('[backfill-mod-hashes] Failed:', err)
		await pool.end().catch(() => {})
		process.exit(1)
	})
