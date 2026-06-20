/**
 * Seed a Steam account as banned (default: account ban).
 * Run with: tsx --env-file=.env src/infrastructure/db/seed-ban.ts
 *
 * Finds or creates the players row for the given SteamID64 (matched by the same
 * salted hash the auth flow uses), then inserts a playerBans row. Idempotent:
 * if an active ban of the same type already exists, it does nothing.
 *
 * Env overrides:
 *   SEED_BAN_STEAM_ID    SteamID64 to ban (default: the DDOSer account below)
 *   SEED_BAN_STEAM_NAME  steam_name to store if the player is new
 *   SEED_BAN_TYPE        'account' | 'queue' | 'chat' (default: account)
 *   SEED_BAN_REASON      ban reason text
 */

import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db, pool } from './index.js'
import { players, playerBans } from './schema.js'
import { hashProviderId } from '../../shared/utils/hash.js'

const STEAM_ID = process.env.SEED_BAN_STEAM_ID ?? '76561199173253306'
const STEAM_NAME = process.env.SEED_BAN_STEAM_NAME ?? 'BannedDDOSer'
const BAN_TYPE = process.env.SEED_BAN_TYPE ?? 'account'
const REASON = process.env.SEED_BAN_REASON ?? 'Seeded ban (DDoS) — test fixture'

async function seed() {
	if (!['account', 'queue', 'chat'].includes(BAN_TYPE)) {
		throw new Error(`Invalid SEED_BAN_TYPE '${BAN_TYPE}'`)
	}

	const steamIdHash = hashProviderId(STEAM_ID)

	// Find or create the player.
	let player = await db.query.players.findFirst({
		where: eq(players.steamIdHash, steamIdHash),
	})

	if (player) {
		console.log(`[seed-ban] Player exists: ${player.id} (${player.steamName})`)
	} else {
		const [created] = await db
			.insert(players)
			.values({ steamName: STEAM_NAME, steamIdHash })
			.returning()
		player = created!
		console.log(
			`[seed-ban] Created player ${player.id} (${player.steamName}) for SteamID ${STEAM_ID}`,
		)
	}

	// Idempotency: skip if an active ban of this type already exists.
	const active = await db
		.select({ id: playerBans.id })
		.from(playerBans)
		.where(
			and(
				eq(playerBans.playerId, player.id),
				eq(playerBans.banType, BAN_TYPE),
				isNull(playerBans.liftedAt),
				or(isNull(playerBans.expiresAt), gt(playerBans.expiresAt, sql`now()`)),
			),
		)
		.limit(1)

	if (active.length > 0) {
		console.log(
			`[seed-ban] Player already has an active '${BAN_TYPE}' ban (${active[0]!.id}) — nothing to do.`,
		)
		return
	}

	const [ban] = await db
		.insert(playerBans)
		.values({
			playerId: player.id,
			banType: BAN_TYPE,
			expiresAt: null, // indefinite
			issuedBy: 'seed',
			reason: REASON,
		})
		.returning()

	console.log(
		`[seed-ban] Inserted ${BAN_TYPE} ban ${ban!.id} on ${player.id} (indefinite).`,
	)
}

seed()
	.then(async () => {
		await pool.end()
		console.log('[seed-ban] Done.')
		process.exit(0)
	})
	.catch(async (err) => {
		console.error('[seed-ban] Error:', err)
		await pool.end().catch(() => {})
		process.exit(1)
	})
