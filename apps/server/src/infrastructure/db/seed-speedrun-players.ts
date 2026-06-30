/**
 * Seed 200 fake players (Player001..Player200) onto both speedrunning ranked
 * boards with varied ratings and best times, then recompute leaderboard_cache.
 *
 * Run with:
 *   tsx --env-file=.env src/infrastructure/db/seed-speedrun-players.ts
 *
 * Non-destructive: uses the active season (ended_at IS NULL), creating Season 0
 * if no season exists yet. Existing players/ratings are skipped
 * (onConflictDoNothing), so PvP boards and real accounts are left untouched.
 *
 * Set SEED_SELF_PLAYER_ID (preferred) or SEED_SELF_STEAM_NAME to also give a
 * real account a mid-pack rating + time on both boards so its row and the "You"
 * footer show up.
 */

import { eq, isNull, sql } from 'drizzle-orm'
import { db, pool } from './index.js'
import { matchmakingRatings, players, seasons } from './schema.js'
import { recomputeLeaderboard } from '../gateways/matchmaking.gateway.js'
import { PLACEMENT_GAMES } from '../../features/matchmaking/elo.service.js'

const PLAYER_COUNT = 200
const MOD_ID = 'MultiplayerSpeedrunning'

interface Board {
	gameMode: string
	/** Best run time in ms for a player at skill rank `i` (0 = fastest). */
	bestTimeMs: (i: number, jitter: number) => number
}

const BOARDS: Board[] = [
	{
		gameMode: 'ranked:spdrn_gold_stake_single',
		bestTimeMs: (i, j) => 90_000 + i * 1_200 + j,
	},
	{
		gameMode: 'ranked:spdrn_white_stake_triple',
		bestTimeMs: (i, j) => 300_000 + i * 3_500 + j,
	},
]

function ratingFor(i: number, boardIdx: number): number {
	const jitter = ((i * 7 + boardIdx * 13) % 19) - 9
	return Math.max(100, 2100 - i * 9 + jitter)
}

function timeJitter(i: number, boardIdx: number): number {
	return ((i * 41 + boardIdx * 97) % 23) * (boardIdx === 0 ? 300 : 1_100)
}

async function getActiveSeasonId(): Promise<number> {
	const [active] = await db
		.select({ id: seasons.id })
		.from(seasons)
		.where(isNull(seasons.endedAt))
		.limit(1)
	if (active) return active.id

	const [created] = await db
		.insert(seasons)
		.values({
			id: 0,
			name: 'Season 0',
			startedAt: new Date(),
			endsAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
		})
		.returning({ id: seasons.id })
	console.log('[seed] No active season — created Season 0')
	return created!.id
}

async function getOrCreatePlayers(): Promise<string[]> {
	const ids: string[] = []
	for (let i = 0; i < PLAYER_COUNT; i++) {
		const steamName = `Player${String(i + 1).padStart(3, '0')}`
		const [existing] = await db
			.select({ id: players.id })
			.from(players)
			.where(eq(players.steamName, steamName))
			.limit(1)
		if (existing) {
			ids.push(existing.id)
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

async function seedRating(
	playerId: string,
	board: Board,
	seasonId: number,
	rank: number,
): Promise<void> {
	const rating = ratingFor(rank, BOARDS.indexOf(board))
	const wins = Math.max(PLACEMENT_GAMES, Math.round((rating - 800) / 10))
	const losses = Math.max(0, Math.round((2100 - rating) / 10))
	await db
		.insert(matchmakingRatings)
		.values({
			playerId,
			modId: MOD_ID,
			gameMode: board.gameMode,
			season: seasonId,
			rating,
			wins,
			losses,
			gamesPlayed: wins + losses,
			seasonBest: board.bestTimeMs(rank, timeJitter(rank, BOARDS.indexOf(board))),
			lastMatchAt: new Date(),
			decayAppliedAt: null,
		})
		.onConflictDoNothing()
}

async function seed() {
	const seasonId = await getActiveSeasonId()
	const playerIds = await getOrCreatePlayers()

	for (const board of BOARDS) {
		for (let i = 0; i < playerIds.length; i++) {
			await seedRating(playerIds[i]!, board, seasonId, i)
		}
		await db.transaction(async (tx) => {
			await recomputeLeaderboard(tx, MOD_ID, board.gameMode, seasonId)
		})
		console.log(`[seed] Recomputed ${MOD_ID} / ${board.gameMode}`)
	}

	const selfPlayerId = process.env.SEED_SELF_PLAYER_ID
	const selfSteamName = process.env.SEED_SELF_STEAM_NAME
	if (selfPlayerId || selfSteamName) {
		const [self] = selfPlayerId
			? await db.select({ id: players.id }).from(players).where(eq(players.id, selfPlayerId)).limit(1)
			: await db.select({ id: players.id }).from(players).where(eq(players.steamName, selfSteamName!)).limit(1)
		if (!self) {
			console.log('[seed] self player not found — skipping self rating')
		} else {
			const midRank = Math.floor(PLAYER_COUNT / 2)
			for (const board of BOARDS) {
				await seedRating(self.id, board, seasonId, midRank)
				await db.transaction(async (tx) => {
					await recomputeLeaderboard(tx, MOD_ID, board.gameMode, seasonId)
				})
			}
			console.log('[seed] Seeded self rating (mid-pack) on both speedrun boards')
		}
	}
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
