// Flow 6: chat end-to-end through the moderation service.
// A and B in a lobby → A sends a message → the relay asks the moderation
// service for a verdict → on allow it publishes to MQTT and B receives it; on
// reject nothing is published and A is told why.
//
// This is the whole chain running for real: relay + EMQX + the guard model in
// its own container. Nothing here is mocked, which is the point — the unit
// tests already cover the decision matrix, and what they cannot prove is that
// the two services actually agree over the wire.
//
// Topic: lobby/{code}/chat/{senderId}   Payload: { message, displayName, ... }

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { E2E_API_URL, E2E_MQTT_URL } from './globalSetup.js'
import { GameClient } from './helpers/client.js'

const MOD = 'E2ETestMod'

function uniqueName(role: string) {
	return `E2E_R6_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

describe('Flow 6: chat through the moderation service', () => {
	let sender: GameClient
	let receiver: GameClient
	let code: string

	beforeEach(async () => {
		sender = new GameClient(E2E_API_URL, E2E_MQTT_URL)
		receiver = new GameClient(E2E_API_URL, E2E_MQTT_URL)
		await sender.impersonate(uniqueName('S'))
		await receiver.impersonate(uniqueName('R'))
		// Accounts start with chat disabled. Without this every send is refused
		// by the account gate before moderation is consulted - which looks
		// exactly like a moderation block and would pass the reject tests below
		// for entirely the wrong reason.
		await sender.enableChat()
		await receiver.enableChat()
		await sender.connectMqtt()
		await receiver.connectMqtt()
		code = (await sender.createLobby(MOD)).code
		await receiver.joinLobby(code)
	})

	afterEach(async () => {
		try {
			await sender.leaveLobby()
		} catch {}
		try {
			await receiver.leaveLobby()
		} catch {}
		await sender.disconnect()
		await receiver.disconnect()
	})

	// Deliberately NOT a preset phrase: the bundled allowlist fast-passes
	// common chat before the model is consulted, so an allowlisted message
	// would prove delivery without proving the guard path works at all.
	const NON_PRESET = 'that last blind went about as well as expected'

	it('delivers an ordinary message to the other player', async () => {
		const topic = `lobby/${code}/chat/${sender.playerId}`
		await receiver.subscribe(topic)
		const delivered = receiver.nextMessage<{ message: string }>(topic)

		const res = await sender.sendChat(NON_PRESET)

		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)
		// No rewrite happened, so the sender is told nothing extra.
		expect(res.body.publishText).toBeUndefined()
		await expect(delivered).resolves.toMatchObject({ message: NON_PRESET })
	})

	it('fast-passes a preset phrase without waiting on the model', async () => {
		const topic = `lobby/${code}/chat/${sender.playerId}`
		await receiver.subscribe(topic)
		const delivered = receiver.nextMessage<{ message: string }>(topic)

		const started = Date.now()
		const res = await sender.sendChat('gg')
		const elapsed = Date.now() - started

		expect(res.status).toBe(200)
		await expect(delivered).resolves.toMatchObject({ message: 'gg' })
		// A guard judgement is ~1s; the allowlist short-circuit is single-digit
		// milliseconds server-side. This is the 60%-of-traffic optimisation, so
		// if it silently stops working the whole service gets an order of
		// magnitude slower without anything failing.
		expect(elapsed).toBeLessThan(600)
	})

	it('blocks a violent threat and publishes nothing', async () => {
		const topic = `lobby/${code}/chat/${sender.playerId}`
		await receiver.subscribe(topic)

		let received: unknown = null
		receiver
			.nextMessage(topic, undefined, 8000)
			.then((m) => {
				received = m
			})
			.catch(() => {
				/* the timeout is the expected outcome */
			})

		const res = await sender.sendChat('i will kill you and your family')

		expect(res.status).toBe(403)
		expect(res.body.ok).toBeUndefined()
		expect(res.body.error).toBeTruthy()
		// A disabled-chat or banned 403 would otherwise satisfy this test
		// without moderation having run at all.
		expect(res.body.error).not.toMatch(/not enabled|banned|restricted/i)

		// The message must not reach the other player. Wait past the point a
		// delivery would have arrived rather than asserting instantly.
		await new Promise((r) => setTimeout(r, 3000))
		expect(received).toBeNull()
	})

	it('tells the sender why, in text a player can read', async () => {
		const res = await sender.sendChat('i will kill you and your family')

		expect(res.status).toBe(403)
		const error = res.body.error ?? ''
		expect(error).not.toMatch(/not enabled|banned|restricted/i)
		// The client renders this string verbatim, so it must be player-facing:
		// no band names, no status codes, no service internals.
		expect(error).not.toMatch(
			/threat_block|guard|band|http|moderation service/i,
		)
		expect(error.length).toBeGreaterThan(0)
		expect(error.length).toBeLessThan(120)
	})

	it('rejects an empty message before it reaches moderation', async () => {
		const res = await sender.sendChat('   ')
		expect(res.status).toBe(400)
	})

	it('rate-limits a burst from one player without blaming the service', async () => {
		// The per-player bucket is burst 5 / 0.5 per second. These MUST go out
		// concurrently: a judgement takes ~1s, so sending them one at a time
		// lets the bucket refill faster than the loop drains it and nothing is
		// ever limited.
		const sent = await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				sender.sendChat(`burst message number ${i}`),
			),
		)
		const results = sent.map((r) => ({ status: r.status, error: r.body.error }))

		// The player's own bucket must be what stops them.
		const limited = results.filter((r) => r.status === 429)
		expect(limited.length).toBeGreaterThan(0)

		// A burst this size against a single-lane guard is also a genuine
		// capacity event, so some 503s are legitimate. What must never happen
		// is the two being confused: a 429 tells the player to slow down, a 503
		// says the service is unavailable. Telling a rate-limited player that
		// chat is broken (or an unlucky bystander that they were spamming) is
		// the actual bug this guards against.
		for (const r of limited) {
			expect(r.error ?? '').toMatch(/too fast|slow down/i)
		}
		for (const r of results.filter((x) => x.status === 503)) {
			expect(r.error ?? '').toMatch(/unavailable/i)
		}

		// And nothing in the burst may be silently accepted-but-undelivered.
		for (const r of results) {
			expect([200, 429, 503]).toContain(r.status)
		}
	}, 60_000)
})
