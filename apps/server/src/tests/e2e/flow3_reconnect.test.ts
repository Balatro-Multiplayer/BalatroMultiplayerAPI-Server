// Flow 3: Disconnect / reconnect within grace period.
// A and B in a private lobby → B's MQTT drops → A receives player_disconnected →
// B reconnects within the 2-min grace period → A receives player_reconnected → lobby intact.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GameClient } from './helpers/client.js'
import { E2E_API_URL, E2E_MQTT_URL } from './globalSetup.js'

const MOD = 'E2ETestMod'

function uniqueName(role: string) {
	return `E2E_R3_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

describe('Flow 3: disconnect / reconnect within grace period', () => {
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
		await playerA.disconnect()
		await playerB.disconnect()
	})

	it('A receives player_disconnected when B drops MQTT', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerA.subscribe(`lobby/${code}/events`)

		const disconnectedPromise = playerA.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'player_disconnected',
		)

		await playerB.disconnect()

		const evt = await disconnectedPromise
		expect(evt.type).toBe('player_disconnected')
		expect(evt.playerId).toBe(playerB.playerId)
	})

	it('A receives player_reconnected after B reconnects within grace period', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerA.subscribe(`lobby/${code}/events`)

		// Register disconnect watcher before triggering the disconnect.
		const disconnectedPromise = playerA.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'player_disconnected',
		)

		await playerB.disconnect()

		// Wait until the server has started B's grace period (player_disconnected fires).
		const disconnEvt = await disconnectedPromise
		expect(disconnEvt.playerId).toBe(playerB.playerId)

		// Register reconnect watcher before triggering the reconnect.
		const reconnectedPromise = playerA.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'player_reconnected',
		)

		// Reconnect: cancels grace period (publishes player_reconnected) then re-establishes MQTT.
		await playerB.reconnect()

		const reconnEvt = await reconnectedPromise
		expect(reconnEvt.type).toBe('player_reconnected')
		expect(reconnEvt.playerId).toBe(playerB.playerId)
	})

	it('lobby still contains both players after reconnect', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerA.subscribe(`lobby/${code}/events`)

		const disconnectedPromise = playerA.nextMessage<{ type: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'player_disconnected',
		)
		await playerB.disconnect()
		await disconnectedPromise

		await playerB.reconnect()
		// Re-subscribe after MQTT reconnect.
		await playerB.subscribe(`lobby/${code}/events`)

		// Use GET /api/lobbies/:code so we don't try to re-join and hit the 409 guard.
		const lobby = await playerA.getLobbyInfo(code)
		expect(lobby.players.some((p) => p.id === playerA.playerId)).toBe(true)
		expect(lobby.players.some((p) => p.id === playerB.playerId)).toBe(true)
	})
})
