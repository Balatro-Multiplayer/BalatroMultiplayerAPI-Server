// Flow 1: Full private lobby lifecycle
// Two clients connect, one creates a lobby, the other joins.
// Tests that MQTT events arrive correctly across the real server stack.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GameClient } from './helpers/client.js'
import { E2E_API_URL, E2E_MQTT_URL } from './globalSetup.js'

// Unique steam name per test run to avoid session collisions when E2E_KEEP_STACK=1.
function uniqueName(role: string) {
	return `E2E_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

describe('Flow 1: lobby lifecycle', () => {
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
		try {
			await playerA.leaveLobby()
		} catch {}
		try {
			await playerB.leaveLobby()
		} catch {}
		await playerA.disconnect()
		await playerB.disconnect()
	})

	it('create lobby returns code and host flag', async () => {
		const lobby = await playerA.createLobby('TestMod')
		expect(lobby.code).toMatch(/^[A-Z0-9]{6}$/)
		expect(lobby.isHost).toBe(true)
		expect(lobby.modId).toBe('TestMod')
		expect(lobby.players).toHaveLength(1)
	})

	it('player_joined event arrives at host when second player joins', async () => {
		const lobby = await playerA.createLobby('TestMod')
		const code = lobby.code

		// Subscribe BEFORE triggering the join so we don't race the event.
		await playerA.subscribe(`lobby/${code}/events`)
		const joinedPromise = playerA.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'player_joined',
		)

		await playerB.joinLobby(code)

		const event = await joinedPromise
		expect(event.type).toBe('player_joined')
		expect(event.playerId).toBe(playerB.playerId)
	})

	it('join returns correct lobby snapshot with both players', async () => {
		const lobbyA = await playerA.createLobby('TestMod')
		const lobbyB = await playerB.joinLobby(lobbyA.code)
		expect(lobbyB.players).toHaveLength(2)
		expect(lobbyB.players.some((p) => p.id === playerA.playerId)).toBe(true)
		expect(lobbyB.players.some((p) => p.id === playerB.playerId)).toBe(true)
	})

	it('host sets metadata via HTTP and B receives it over MQTT', async () => {
		const lobby = await playerA.createLobby('TestMod')
		const code = lobby.code
		await playerB.joinLobby(code)

		// Subscribe B before the publish so we don't miss the retained message.
		await playerB.subscribe(`lobby/${code}/metadata`)
		const metaPromise = playerB.nextMessage<{ gameMode: string }>(
			`lobby/${code}/metadata`,
		)

		await playerA.setMetadata(code, { gameMode: 'casual:free' })

		const meta = await metaPromise
		expect(meta.gameMode).toBe('casual:free')
	})

	it('B can publish retained player state to own state topic', async () => {
		const lobby = await playerA.createLobby('TestMod')
		const code = lobby.code
		await playerB.joinLobby(code)

		const stateTopic = `lobby/${code}/players/${playerB.playerId}/state`
		const statePromise = playerB.waitFor<{ score: number }>(stateTopic)

		// B publishes retained state — EMQX authz allows this for own topic.
		playerB.publish(stateTopic, { score: 42 }, { retain: true })

		const state = await statePromise
		expect(state.score).toBe(42)
	})

	it('player_left event fires when B leaves', async () => {
		const lobby = await playerA.createLobby('TestMod')
		const code = lobby.code
		await playerB.joinLobby(code)

		await playerA.subscribe(`lobby/${code}/events`)
		const leftPromise = playerA.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'player_left',
		)

		await playerB.leaveLobby()

		const event = await leftPromise
		expect(event.type).toBe('player_left')
		expect(event.playerId).toBe(playerB.playerId)
	})

	it('host leaving with remaining player fires host_changed then player is the new host', async () => {
		const lobby = await playerA.createLobby('TestMod')
		const code = lobby.code
		await playerB.joinLobby(code)

		await playerB.subscribe(`lobby/${code}/events`)
		const hostChangedPromise = playerB.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'host_changed',
		)

		await playerA.leaveLobby()

		const event = await hostChangedPromise
		expect(event.type).toBe('host_changed')
		expect(event.playerId).toBe(playerB.playerId)
	})

	it('lobby_closed fires when the last player (host) leaves', async () => {
		const lobby = await playerA.createLobby('TestMod')
		const code = lobby.code

		await playerA.subscribe(`lobby/${code}/events`)
		const closedPromise = playerA.nextMessage<{ type: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'lobby_closed',
		)

		// Host leaves as the only player → lobby_closed
		await playerA.leaveLobby()

		const event = await closedPromise
		expect(event.type).toBe('lobby_closed')
	})
})
