/**
 * Seed the leaderboards with test data for every ranked board.
 * Run with: tsx --env-file=.env src/infrastructure/db/seed-leaderboard.ts
 *
 * Creates an active season (if none), a shared pool of fake players, a
 * matchmaking_ratings row per (player, board), then recomputes leaderboard_cache
 * so /api/stats/leaderboard returns data. Idempotent: existing players/ratings
 * are skipped (onConflictDoNothing).
 *
 * Boards mirror apps/web/src/lib/leaderboards.ts and metrics.config.ts:
 *   Speedrun (MultiplayerSpeedrunning) — secondary metric = time_ms (lower better)
 *   PvP      (MultiplayerPvP)          — secondary metric = score   (higher better)
 * gameMode strings carry the matchmaking `ranked:` prefix (what the cache stores).
 */

import { eq, sql } from 'drizzle-orm'
import { db, pool } from './index.js'
import { matchmakingRatings, players } from './schema.js'
import { recomputeLeaderboard } from '../gateways/matchmaking.gateway.js'

const PLAYER_COUNT = 250

type MetricKind = 'time_ms' | 'score'

interface Board {
	modId: string
	gameMode: string
	metric: MetricKind
	/** Per-player season-best for rank i (0 = top). */
	seasonBest: (i: number, jitter: number) => number
}

const BOARDS: Board[] = [
	{
		modId: 'MultiplayerSpeedrunning',
		gameMode: 'ranked:spdrn_gold_stake_single',
		metric: 'time_ms',
		// ~2:00 and up; faster (smaller) for higher ranks.
		seasonBest: (i, j) => 120_000 + i * 1_500 + j,
	},
	{
		modId: 'MultiplayerSpeedrunning',
		gameMode: 'ranked:spdrn_white_stake_triple',
		metric: 'time_ms',
		// ~6:00 and up (three antes → longer runs).
		seasonBest: (i, j) => 360_000 + i * 4_000 + j,
	},
	{
		modId: 'MultiplayerPvP',
		gameMode: 'ranked:pvp_standard',
		metric: 'score',
		seasonBest: (i, j) => 50_000_000 - i * 350_000 + j,
	},
	{
		modId: 'MultiplayerPvP',
		gameMode: 'ranked:pvp_vanilla',
		metric: 'score',
		seasonBest: (i, j) => 30_000_000 - i * 220_000 + j,
	},
	{
		modId: 'MultiplayerPvP',
		gameMode: 'ranked:pvp_expanded',
		metric: 'score',
		seasonBest: (i, j) => 80_000_000 - i * 600_000 + j,
	},
	{
		modId: 'MultiplayerPvP',
		gameMode: 'ranked:pvp_smallworld',
		metric: 'score',
		seasonBest: (i, j) => 20_000_000 - i * 150_000 + j,
	},
]

// Deterministic per-(player, board) rating with a little jitter so boards aren't
// identical and the ranking isn't perfectly linear.
function ratingFor(i: number, boardIdx: number): number {
	const jitter = ((i * 7 + boardIdx * 13) % 15) - 7
	return Math.max(100, 2000 - i * 11 + jitter)
}

function metricJitter(i: number, boardIdx: number): number {
	// Small positive jitter; scaled per metric in the board formula's units.
	return ((i * 37 + boardIdx * 101) % 17) * (boardIdx < 2 ? 250 : 7_000)
}

// Dev reset: wipe board data and reseat the seasons table so the single active
// season (ended_at IS NULL) is Season 0. Destructive — this is a dev seed tool.
async function resetToSeason0(): Promise<number> {
	await db.execute(sql`DELETE FROM leaderboard_cache`)
	await db.execute(sql`DELETE FROM matchmaking_ratings`)
	await db.execute(sql`DELETE FROM seasons`)
	// Next auto-created (rollover) season becomes id 1 → "Season 1".
	await db.execute(sql`SELECT setval(pg_get_serial_sequence('seasons','id'), 1, false)`)
	await db.execute(sql`
		INSERT INTO seasons (id, name, started_at, ends_at)
		VALUES (0, 'Season 0', now(), now() + interval '90 days')
	`)
	console.log('[seed] Reset seasons → active Season 0 (id 0)')
	return 0
}

async function getOrCreatePlayers(): Promise<string[]> {
	const ids: string[] = []
	for (let i = 0; i < PLAYER_COUNT; i++) {
		const steamName = `Runner${String(i + 1).padStart(3, '0')}`
		const existing = await db
			.select({ id: players.id })
			.from(players)
			.where(eq(players.steamName, steamName))
			.limit(1)
		if (existing[0]) {
			ids.push(existing[0].id)
			continue
		}
		const [created] = await db
			.insert(players)
			.values({ steamName, tosAcceptedVersion: 1 })
			.returning({ id: players.id })
		ids.push(created!.id)
	}
	console.log(`[seed] ${PLAYER_COUNT} players ready`)
	return ids
}

async function seed() {
	const seasonId = await resetToSeason0()
	const playerIds = await getOrCreatePlayers()

	for (let b = 0; b < BOARDS.length; b++) {
		const board = BOARDS[b]!
		for (let i = 0; i < playerIds.length; i++) {
			const rating = ratingFor(i, b)
			const wins = Math.max(0, Math.round((rating - 800) / 10))
			const losses = Math.max(0, Math.round((2000 - rating) / 10))
			await db
				.insert(matchmakingRatings)
				.values({
					playerId: playerIds[i]!,
					modId: board.modId,
					gameMode: board.gameMode,
					season: seasonId,
					rating,
					wins,
					losses,
					gamesPlayed: wins + losses,
					seasonBest: board.seasonBest(i, metricJitter(i, b)),
					lastMatchAt: new Date(),
					decayAppliedAt: null,
				})
				.onConflictDoNothing()
		}
		await db.transaction(async (tx) => {
			await recomputeLeaderboard(tx, board.modId, board.gameMode, seasonId)
		})
		console.log(`[seed] Recomputed ${board.modId} / ${board.gameMode}`)
	}

	// Optionally give the calling player a mid-pack rating on every board so their
	// own row (and the "You" footer) shows. Set SEED_SELF_PLAYER_ID (preferred) or
	// SEED_SELF_STEAM_NAME.
	const selfPlayerId = process.env.SEED_SELF_PLAYER_ID
	const selfSteamName = process.env.SEED_SELF_STEAM_NAME
	if (selfPlayerId || selfSteamName) {
		const self = selfPlayerId
			? await db.select({ id: players.id }).from(players).where(eq(players.id, selfPlayerId)).limit(1)
			: await db.select({ id: players.id }).from(players).where(eq(players.steamName, selfSteamName!)).limit(1)
		if (!self[0]) {
			console.log(`[seed] self player not found — skipping self rating`)
		} else {
			for (let b = 0; b < BOARDS.length; b++) {
				const board = BOARDS[b]!
				const rating = 1500
				const wins = Math.round((rating - 800) / 10)
				const losses = Math.round((2000 - rating) / 10)
				await db
					.insert(matchmakingRatings)
					.values({
						playerId: self[0].id,
						modId: board.modId,
						gameMode: board.gameMode,
						season: seasonId,
						rating,
						wins,
						losses,
						gamesPlayed: wins + losses,
						seasonBest: board.seasonBest(50, metricJitter(50, b)),
						lastMatchAt: new Date(),
						decayAppliedAt: null,
					})
					.onConflictDoNothing()
				await db.transaction(async (tx) => {
					await recomputeLeaderboard(tx, board.modId, board.gameMode, seasonId)
				})
			}
			console.log(`[seed] Seeded self rating (mid-pack) on all boards`)
		}
	}

	// No pointer to set — the active season is Season 0 (ended_at IS NULL),
	// which getCurrentSeason() resolves directly from the seasons table.
}

seed()
	.then(async () => {
		await pool.end()
		console.log('[seed] Done.')
		process.exit(0)
	})
	.catch(async (err) => {
		console.error('[seed] Error:', err)
		await pool.end().catch(() => {})
		process.exit(1)
	})
