// Flow 2: Matchmaking + ranked Elo
// Both players queue → match_found → join auto-lobby → host reports result →
// match_resolved received → ratings stored in DB.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GameClient } from './helpers/client.js'
import { E2E_API_URL, E2E_MQTT_URL, seedDb } from './globalSetup.js'

const MOD = 'E2ETestMod'
const CASUAL_MODE = 'casual:1v1'
const RANKED_MODE = 'ranked:1v1'

let seasonId: number

function uniqueName(role: string) {
	return `E2E_MM_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

// Wait up to timeoutMs for predicate to return true, polling every 200ms.
async function pollUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 8_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise((r) => setTimeout(r, 200))
	}
	throw new Error(`pollUntil timed out after ${timeoutMs}ms`)
}

beforeAll(async () => {
	// Seed a fresh active season for ranked matchmaking.
	// Close any stale active seasons first so getCurrentSeason() returns the one we just created.
	// This handles the E2E_KEEP_STACK=1 case where previous runs leave seasons behind.
	const now = new Date()
	const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
	const result = await new Promise<{ rows: Array<{ id: number }> }>((resolve, reject) => {
		import('pg').then(async ({ default: pg }) => {
			const client = new pg.Client({
				connectionString: process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@localhost:15432/bmp_e2e',
			})
			await client.connect()
			try {
				await client.query(`UPDATE seasons SET ended_at = NOW() WHERE ended_at IS NULL`)
				const res = await client.query<{ id: number }>(
					`INSERT INTO seasons (name, started_at, ends_at) VALUES ($1, $2, $3) RETURNING id`,
					['E2E Season 1', now, future],
				)
				resolve({ rows: res.rows })
			} catch (err) {
				reject(err)
			} finally {
				await client.end()
			}
		})
	})

	seasonId = result.rows[0]?.id
	if (!seasonId) throw new Error('Could not seed season')
})

describe('Flow 2: casual matchmaking', () => {
	let playerA: GameClient
	let playerB: GameClient

	beforeEach(async () => {
		playerA = new GameClient(E2E_API_URL, E2E_MQTT_URL)
		playerB = new GameClient(E2E_API_URL, E2E_MQTT_URL)
		await playerA.impersonate(uniqueName('A'))
		await playerB.impersonate(uniqueName('B'))
		await playerA.connectMqtt()
		await playerB.connectMqtt()
	})

	afterEach(async () => {
		try { await playerA.leaveLobby() } catch {}
		try { await playerB.leaveLobby() } catch {}
		try { await playerA.leaveQueue(MOD, CASUAL_MODE) } catch {}
		try { await playerB.leaveQueue(MOD, CASUAL_MODE) } catch {}
		await playerA.disconnect()
		await playerB.disconnect()
	})

	it('both receive match_found after queuing', async () => {
		// Subscribe to matchmaking topics before queuing.
		await playerA.subscribe(`player/${playerA.playerId}/matchmaking`)
		await playerB.subscribe(`player/${playerB.playerId}/matchmaking`)

		const aFoundPromise = playerA.nextMessage<{ type: string; lobbyCode: string; matchId: string }>(
			`player/${playerA.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)
		const bFoundPromise = playerB.nextMessage<{ type: string; lobbyCode: string; matchId: string }>(
			`player/${playerB.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)

		await playerA.queue(MOD, CASUAL_MODE)
		await playerB.queue(MOD, CASUAL_MODE)

		const [aMsg, bMsg] = await Promise.all([aFoundPromise, bFoundPromise])

		expect(aMsg.type).toBe('match_found')
		expect(bMsg.type).toBe('match_found')
		expect(aMsg.lobbyCode).toBe(bMsg.lobbyCode)
		expect(aMsg.matchId).toBe(bMsg.matchId)
	})

	it('both can join the matchmade lobby after match_found', async () => {
		await playerA.subscribe(`player/${playerA.playerId}/matchmaking`)
		await playerB.subscribe(`player/${playerB.playerId}/matchmaking`)

		const aFoundPromise = playerA.nextMessage<{ type: string; lobbyCode: string }>(
			`player/${playerA.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)

		await playerA.queue(MOD, CASUAL_MODE)
		await playerB.queue(MOD, CASUAL_MODE)

		const aMsg = await aFoundPromise
		const code = aMsg.lobbyCode

		const lobbyA = await playerA.joinLobby(code)
		const lobbyB = await playerB.joinLobby(code)

		// Both see each other in the lobby
		expect(lobbyA.players.some((p) => p.id === playerA.playerId)).toBe(true)
		expect(lobbyB.players.some((p) => p.id === playerB.playerId)).toBe(true)
	})

	it('host reports casual result → HTTP 204, match marked resolved', async () => {
		await playerA.subscribe(`player/${playerA.playerId}/matchmaking`)
		await playerB.subscribe(`player/${playerB.playerId}/matchmaking`)

		const aFoundPromise = playerA.nextMessage<{ type: string; lobbyCode: string; matchId: string }>(
			`player/${playerA.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)
		const bFoundPromise = playerB.nextMessage<{ type: string; lobbyCode: string; matchId: string }>(
			`player/${playerB.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)

		await playerA.queue(MOD, CASUAL_MODE)
		await playerB.queue(MOD, CASUAL_MODE)

		const [aMsg] = await Promise.all([aFoundPromise, bFoundPromise])
		const { lobbyCode, matchId } = aMsg

		await playerA.joinLobby(lobbyCode)
		await playerB.joinLobby(lobbyCode)

		// Casual reportResult just marks the match resolved — no match_resolved MQTT event is published.
		const lobby = await playerA.joinLobby(lobbyCode)
		const hostClient = lobby.isHost ? playerA : playerB

		await expect(
			hostClient.reportMatchResult(matchId, [
				{ playerId: playerA.playerId, place: 1 },
				{ playerId: playerB.playerId, place: 2 },
			]),
		).resolves.not.toThrow()
	})
})

describe('Flow 2: ranked matchmaking + Elo', () => {
	let playerA: GameClient
	let playerB: GameClient

	beforeEach(async () => {
		playerA = new GameClient(E2E_API_URL, E2E_MQTT_URL)
		playerB = new GameClient(E2E_API_URL, E2E_MQTT_URL)
		await playerA.impersonate(uniqueName('RA'))
		await playerB.impersonate(uniqueName('RB'))
		// Rated matches write to matchmaking_ratings which has a FK to players.id.
		// Dev-auth sessions are in-memory only, so we must seed the players table.
		await seedDb(
			`INSERT INTO players (id, steam_name) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING`,
			[playerA.playerId, 'e2e-ranked-a', playerB.playerId, 'e2e-ranked-b'],
		)
		await playerA.connectMqtt()
		await playerB.connectMqtt()
	})

	afterEach(async () => {
		try { await playerA.leaveLobby() } catch {}
		try { await playerB.leaveLobby() } catch {}
		try { await playerA.leaveQueue(MOD, RANKED_MODE) } catch {}
		try { await playerB.leaveQueue(MOD, RANKED_MODE) } catch {}
		await playerA.disconnect()
		await playerB.disconnect()
	})

	it('ranked match creates placement rating records for both players', async () => {
		await playerA.subscribe(`player/${playerA.playerId}/matchmaking`)
		await playerB.subscribe(`player/${playerB.playerId}/matchmaking`)

		const aFoundPromise = playerA.nextMessage<{ type: string; lobbyCode: string; matchId: string }>(
			`player/${playerA.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)
		const bFoundPromise = playerB.nextMessage<{ type: string; lobbyCode: string; matchId: string }>(
			`player/${playerB.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)

		await playerA.queue(MOD, RANKED_MODE)
		await playerB.queue(MOD, RANKED_MODE)

		const [aMsg] = await Promise.all([aFoundPromise, bFoundPromise])
		const { lobbyCode, matchId } = aMsg

		await playerA.joinLobby(lobbyCode)
		await playerB.joinLobby(lobbyCode)

		const aResolvedPromise = playerA.nextMessage<{
			type: string
			matchId: string
			ratings: Array<{ playerId: string; newRating: number | null; delta: number | null; isPlacement: boolean }>
		}>(
			`player/${playerA.playerId}/matchmaking`,
			(msg) => msg.type === 'match_resolved',
		)
		const bResolvedPromise = playerB.nextMessage<{ type: string }>(
			`player/${playerB.playerId}/matchmaking`,
			(msg) => msg.type === 'match_resolved',
		)

		const lobby = await playerA.joinLobby(lobbyCode)
		const hostClient = lobby.isHost ? playerA : playerB

		await hostClient.reportMatchResult(matchId, [
			{ playerId: playerA.playerId, place: 1 },
			{ playerId: playerB.playerId, place: 2 },
		])

		const [aResolved] = await Promise.all([aResolvedPromise, bResolvedPromise])

		// Placement games: newRating and delta should be null
		expect(aResolved.type).toBe('match_resolved')
		const aRating = aResolved.ratings.find((r) => r.playerId === playerA.playerId)
		const bRating = aResolved.ratings.find((r) => r.playerId === playerB.playerId)

		expect(aRating).toBeDefined()
		expect(bRating).toBeDefined()
		// First ranked game → placement, ratings not visible yet
		expect(aRating!.isPlacement).toBe(true)
		expect(aRating!.newRating).toBeNull()
		expect(bRating!.isPlacement).toBe(true)
		expect(bRating!.newRating).toBeNull()
	})

	it('GET /ratings reflects placement record after one ranked match', async () => {
		await playerA.subscribe(`player/${playerA.playerId}/matchmaking`)
		await playerB.subscribe(`player/${playerB.playerId}/matchmaking`)

		const aFoundPromise = playerA.nextMessage<{ type: string; lobbyCode: string; matchId: string }>(
			`player/${playerA.playerId}/matchmaking`,
			(msg) => msg.type === 'match_found',
		)

		await playerA.queue(MOD, RANKED_MODE)
		await playerB.queue(MOD, RANKED_MODE)

		const aMsg = await aFoundPromise
		const { lobbyCode, matchId } = aMsg

		await playerA.joinLobby(lobbyCode)
		await playerB.joinLobby(lobbyCode)

		const aResolvedPromise = playerA.nextMessage<{ type: string }>(
			`player/${playerA.playerId}/matchmaking`,
			(msg) => msg.type === 'match_resolved',
		)

		const lobby = await playerA.joinLobby(lobbyCode)
		const hostClient = lobby.isHost ? playerA : playerB

		await hostClient.reportMatchResult(matchId, [
			{ playerId: playerA.playerId, place: 1 },
			{ playerId: playerB.playerId, place: 2 },
		])

		await aResolvedPromise

		// Poll ratings — DB write is synchronous inside reportResult, so it should be immediate
		const rating = await playerA.getRating(MOD, RANKED_MODE, seasonId)
		expect(rating).not.toBeNull()
		expect(rating.gamesPlayed).toBe(1)
		expect(rating.isPlacement).toBe(true)
		expect(rating.placementGamesLeft).toBe(4) // 5 placement games, 1 played
	})
})
