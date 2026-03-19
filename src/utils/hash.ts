import { createHash } from 'node:crypto'
import { env } from '../env.js'

/**
 * Deterministically hashes a provider ID (Steam or Discord) with the server-side salt.
 * The result is stored in the DB instead of the raw ID, preventing enumeration attacks
 * and severing the link to the provider's public profile.
 *
 * IMPORTANT: never rotate PLAYER_ID_SALT after launch — existing records will become
 * unmatchable and all users will be treated as new accounts.
 */
export function hashProviderId(rawId: string): string {
	return createHash('sha256').update(rawId + env.PLAYER_ID_SALT).digest('hex')
}
