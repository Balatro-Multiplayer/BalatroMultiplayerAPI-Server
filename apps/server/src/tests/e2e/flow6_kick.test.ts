// Flow 6: Host-only kick + rejoin block.
// A hosts, B joins → A kicks B → B receives player_kicked over MQTT → B's
// subsequent rejoin attempt is rejected by the server.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GameClient } from './helpers/client.js'
import { E2E_API_URL, E2E_MQTT_URL } from './globalSetup.js'

const MOD = 'E2ETestMod'

function uniqueName(role: string) {
	return `E2E_R6_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

describe('Flow 6: host kick + rejoin block', () => {
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

	it('B receives player_kicked when A (host) kicks B', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		// Subscribe BEFORE triggering the kick so we don't race the event.
		await playerB.subscribe(`lobby/${code}/events`)
		const kickedPromise = playerB.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'player_kicked',
		)

		await playerA.kick(code, playerB.playerId)

		const evt = await kickedPromise
		expect(evt.type).toBe('player_kicked')
		expect(evt.playerId).toBe(playerB.playerId)
	})

	it('B cannot rejoin the lobby after being kicked', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerA.kick(code, playerB.playerId)

		await expect(playerB.joinLobby(code)).rejects.toThrow('403')
	})

	it('A (non-host) cannot kick B', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await expect(playerB.kick(code, playerA.playerId)).rejects.toThrow('403')
	})
})
