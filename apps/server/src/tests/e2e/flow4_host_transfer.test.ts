// Flow 4: Host disconnect → automatic host transfer.
// A hosts, B joins → A's MQTT drops → host_changed fires immediately (before grace period) →
// B is now host → B can set metadata → A reconnects → A is no longer host → A cannot set metadata.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GameClient } from './helpers/client.js'
import { E2E_API_URL, E2E_MQTT_URL } from './globalSetup.js'

const MOD = 'E2ETestMod'

function uniqueName(role: string) {
	return `E2E_R4_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

describe('Flow 4: host disconnect → transfer', () => {
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

	it('B receives host_changed immediately when A (host) disconnects', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerB.subscribe(`lobby/${code}/events`)

		// host_changed fires before player_disconnected — register watcher first.
		const hostChangedPromise = playerB.nextMessage<{ type: string; playerId: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'host_changed',
		)

		await playerA.disconnect()

		const evt = await hostChangedPromise
		expect(evt.type).toBe('host_changed')
		expect(evt.playerId).toBe(playerB.playerId)
	})

	it('B can set metadata after becoming host', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerB.subscribe(`lobby/${code}/events`)
		const hostChangedPromise = playerB.nextMessage<{ type: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'host_changed',
		)

		await playerA.disconnect()
		await hostChangedPromise

		const meta = await playerB.setMetadata(code, { round: 1 })
		expect(meta).toMatchObject({ round: 1 })
	})

	it('A cannot set metadata after reconnecting as non-host', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerB.subscribe(`lobby/${code}/events`)
		const hostChangedPromise = playerB.nextMessage<{ type: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'host_changed',
		)

		await playerA.disconnect()
		await hostChangedPromise

		// A reconnects within grace period; B remains host.
		await playerA.reconnect()

		// A tries to set metadata — should be refused.
		await expect(playerA.setMetadata(code, { round: 2 })).rejects.toThrow('403')
	})

	it('A is not host after reconnecting (getLobbyInfo confirms)', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		await playerB.subscribe(`lobby/${code}/events`)
		const hostChangedPromise = playerB.nextMessage<{ type: string }>(
			`lobby/${code}/events`,
			(msg) => msg.type === 'host_changed',
		)

		await playerA.disconnect()
		await hostChangedPromise

		await playerA.reconnect()

		const lobby = await playerA.getLobbyInfo(code)
		expect(lobby.hostId).toBe(playerB.playerId)
		expect(lobby.isHost).toBe(false) // querying as A
	})
})
