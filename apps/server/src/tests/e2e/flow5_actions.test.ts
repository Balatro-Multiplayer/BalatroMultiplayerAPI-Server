// Flow 5: Action request / response round-trip.
// A and B in lobby → A sends a directed action to B → B receives it → B responds →
// A's callback fires with the correct cid → an unrelated response does not trigger A's listener.
//
// Topic: lobby/{code}/players/{sender}/actions  (sender publishes to own topic; any member subscribes)
// Payload: { cid, action, from, to, params }
// Response payload: { cid, action, from, to, response_to: originalCid, params }

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GameClient } from './helpers/client.js'
import { E2E_API_URL, E2E_MQTT_URL } from './globalSetup.js'

const MOD = 'E2ETestMod'

function uniqueName(role: string) {
	return `E2E_R5_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

describe('Flow 5: action request / response round-trip', () => {
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

	it('B receives directed action sent by A', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		const topicA = `lobby/${code}/players/${playerA.playerId}/actions`
		await playerB.subscribe(topicA)

		const actionPromise = playerB.nextMessage<{ cid: string; action: string; from: string; to: string }>(
			topicA,
			(msg) => msg.to === playerB.playerId,
		)

		playerA.publish(topicA, {
			cid: 'cid-001',
			action: 'ping',
			from: playerA.playerId,
			to: playerB.playerId,
			params: {},
		})

		const received = await actionPromise
		expect(received.cid).toBe('cid-001')
		expect(received.action).toBe('ping')
		expect(received.from).toBe(playerA.playerId)
		expect(received.to).toBe(playerB.playerId)
	})

	it("A's callback fires with correct cid when B responds", async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		const topicA = `lobby/${code}/players/${playerA.playerId}/actions`
		const topicB = `lobby/${code}/players/${playerB.playerId}/actions`

		// A subscribes to B's topic to receive the response.
		await playerA.subscribe(topicB)
		// B subscribes to A's topic to receive the request.
		await playerB.subscribe(topicA)

		const cid = 'req-abc'

		const responsePromise = playerA.nextMessage<{ response_to: string; params: Record<string, unknown> }>(
			topicB,
			(msg) => msg.response_to === cid,
		)

		const requestPromise = playerB.nextMessage<{ cid: string; to: string }>(
			topicA,
			(msg) => msg.to === playerB.playerId,
		)

		// A sends the request.
		playerA.publish(topicA, {
			cid,
			action: 'ping',
			from: playerA.playerId,
			to: playerB.playerId,
			params: { seq: 1 },
		})

		// B receives and responds.
		await requestPromise
		playerB.publish(topicB, {
			cid: 'res-xyz',
			action: 'ping',
			from: playerB.playerId,
			to: playerA.playerId,
			response_to: cid,
			params: { pong: true },
		})

		const response = await responsePromise
		expect(response.response_to).toBe(cid)
		expect(response.params).toMatchObject({ pong: true })
	})

	it('unrelated response from B does not fire cid-isolated listener', async () => {
		const code = (await playerA.createLobby(MOD)).code
		await playerB.joinLobby(code)

		const topicB = `lobby/${code}/players/${playerB.playerId}/actions`
		await playerA.subscribe(topicB)

		const targetCid = 'req-target'
		const unrelatedCid = 'req-other'

		// Two separate listeners with different cid predicates.
		const targetPromise = playerA.nextMessage<{ response_to: string }>(
			topicB,
			(msg) => msg.response_to === targetCid,
		)
		const unrelatedPromise = playerA.nextMessage<{ response_to: string }>(
			topicB,
			(msg) => msg.response_to === unrelatedCid,
		)

		// B sends unrelated response first.
		playerB.publish(topicB, {
			cid: 'r1',
			action: 'ping',
			from: playerB.playerId,
			to: playerA.playerId,
			response_to: unrelatedCid,
			params: {},
		})

		// B sends the target response second.
		playerB.publish(topicB, {
			cid: 'r2',
			action: 'ping',
			from: playerB.playerId,
			to: playerA.playerId,
			response_to: targetCid,
			params: {},
		})

		// Both promises resolve, each for its own cid.
		const [targetRes, unrelatedRes] = await Promise.all([targetPromise, unrelatedPromise])
		expect(targetRes.response_to).toBe(targetCid)
		expect(unrelatedRes.response_to).toBe(unrelatedCid)
	})
})
