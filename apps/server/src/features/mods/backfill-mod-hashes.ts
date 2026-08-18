/**
 * Recomputes every mod_registry_versions row's sha256 under the corrected
 * folder-content-hash algorithm (see mods-sync.service.ts's
 * computeModFolderHashForRelease doc comment and mod-folder-hash.ts) --
 * every hash stored before that rewrite was computed over an archive (the
 * raw GitHub download, and later a rebuilt deterministic zip -- see git
 * history), never a plain directory's content, which is never what
 * RunController::currentModMatchesServerHash() (new-launcher) actually
 * verifies against now.
 *
 * One-time maintenance operation, not part of the regular hourly/startup
 * sync -- run it explicitly, once, after deploying the folder-hash rewrite.
 * Safe to re-run: recomputing an already-correct hash just produces the
 * same value again.
 *
 * Needs the same runtime as the server itself -- network access to every
 * mod's GitHub download URL -- so run it inside the deployed container,
 * e.g.:
 *
 *   docker compose exec api pnpm --filter balatro-multiplayer-api-server backfill-mod-hashes
 *
 * or locally against a real DATABASE_URL:
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
