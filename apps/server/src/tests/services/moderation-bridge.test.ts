import { describe, expect, it, vi } from 'vitest'
import { processAndPublishMessage } from '../../features/chat/chat.service.js'
import { decideDelivery } from '../../features/chat/moderation-policy.js'
import {
	type ModerationBridge,
	type ModerationResult,
	moderateRemote,
} from '../../infrastructure/gateways/moderation.gateway.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { setConfig } from '../../state/config.js'
import { Lobby, createSession, lobbies } from '../../state/index.js'

function fetchStub(status: number, body: unknown): typeof fetch {
	return (async (_url: string | URL, init?: RequestInit) => {
		;(fetchStub as { lastInit?: RequestInit }).lastInit = init
		return new Response(
			typeof body === 'string' ? body : JSON.stringify(body),
			{ status, headers: { 'content-type': 'application/json' } },
		)
	}) as unknown as typeof fetch
}

function bridge(
	fetchFn: typeof fetch,
	over?: Partial<ModerationBridge>,
): ModerationBridge {
	return {
		url: 'http://moderation.test',
		bearerToken: 't',
		timeoutMs: 1500,
		outagePolicy: 'off',
		fetchFn,
		...over,
	}
}

const PAYLOAD = {
	playerId: 'p1',
	displayName: 'Tester',
	lobbyCode: 'ABCD',
	message: 'hello',
}

describe('decideDelivery — the pure verdict/outage matrix', () => {
	const allow = (publishText?: string): ModerationResult => ({
		status: 'verdict',
		verdict: { verdict: 'allow', ...(publishText ? { publishText } : {}) },
	})

	it.each([
		[
			'allow, no rewrite',
			allow(),
			'hi',
			false,
			'off',
			{ action: 'publish', text: 'hi' },
		],
		[
			'allow, rewrite',
			allow('hi!'),
			'hi',
			false,
			'off',
			{ action: 'publish', text: 'hi!' },
		],
		[
			'allow, empty rewrite falls back to original',
			{
				status: 'verdict',
				verdict: { verdict: 'allow', publishText: '' },
			},
			'hi',
			false,
			'off',
			{ action: 'publish', text: 'hi' },
		],
		[
			'reject generic band',
			{ status: 'verdict', verdict: { verdict: 'reject', band: 'blocklist' } },
			'hi',
			false,
			'off',
			{ action: 'reject', rejection: { ok: false, reason: 'moderated' } },
		],
		[
			'reject muted',
			{
				status: 'verdict',
				verdict: { verdict: 'reject', band: 'muted', mutedUntil: 'T' },
			},
			'hi',
			false,
			'off',
			{
				action: 'reject',
				rejection: { ok: false, reason: 'muted', mutedUntil: 'T' },
			},
		],
		[
			'reject rate_limited band',
			{
				status: 'verdict',
				verdict: { verdict: 'reject', band: 'rate_limited', retryAfterMs: 5 },
			},
			'hi',
			false,
			'off',
			{
				action: 'reject',
				rejection: { ok: false, reason: 'rate_limited', retryAfterMs: 5 },
			},
		],
		[
			'shed maps to rate_limited',
			{ status: 'shed', retryAfterMs: 9 },
			'hi',
			false,
			'off',
			{
				action: 'reject',
				rejection: { ok: false, reason: 'rate_limited', retryAfterMs: 9 },
			},
		],
		[
			'unreachable, policy off',
			{ status: 'unreachable', cause: 'x' },
			'hi',
			true,
			'off',
			{
				action: 'reject',
				rejection: { ok: false, reason: 'moderation_unavailable' },
			},
		],
		[
			'unreachable, presets + allowlisted',
			{ status: 'unreachable', cause: 'x' },
			'gg',
			true,
			'presets',
			{ action: 'publish', text: 'gg' },
		],
		[
			'unreachable, presets + free text',
			{ status: 'unreachable', cause: 'x' },
			'hi',
			false,
			'presets',
			{
				action: 'reject',
				rejection: { ok: false, reason: 'moderation_unavailable' },
			},
		],
	] as const)(
		'%s',
		(_name, outcome, message, allowlisted, policy, expected) => {
			expect(
				decideDelivery(
					outcome as ModerationResult,
					message,
					allowlisted,
					policy,
				),
			).toEqual(expected)
		},
	)
})

describe('moderateRemote', () => {
	it('passes through an allow verdict and sends bearer + abort signal', async () => {
		const f = fetchStub(200, { verdict: 'allow', band: 'clean' })
		const r = await moderateRemote(PAYLOAD, bridge(f))
		expect(r).toMatchObject({
			status: 'verdict',
			verdict: { verdict: 'allow' },
		})
		const init = (fetchStub as { lastInit?: RequestInit }).lastInit
		expect(init?.signal).toBeInstanceOf(AbortSignal)
		expect((init?.headers as Record<string, string>).authorization).toBe(
			'Bearer t',
		)
	})

	it('omits the Authorization header when no bearer is configured', async () => {
		const f = fetchStub(200, { verdict: 'allow' })
		const b = bridge(f)
		b.bearerToken = undefined
		await moderateRemote(PAYLOAD, b)
		const init = (fetchStub as { lastInit?: RequestInit }).lastInit
		expect(init?.headers as Record<string, string>).not.toHaveProperty(
			'authorization',
		)
	})

	it('maps 429 to shed with retryAfterMs', async () => {
		const r = await moderateRemote(
			PAYLOAD,
			bridge(fetchStub(429, { retryAfterMs: 2000 })),
		)
		expect(r).toEqual({ status: 'shed', retryAfterMs: 2000 })
	})

	it('maps 5xx/503/401 to unreachable (fail closed)', async () => {
		for (const status of [500, 503, 401]) {
			const r = await moderateRemote(PAYLOAD, bridge(fetchStub(status, {})))
			expect(r).toEqual({ status: 'unreachable', cause: `http_${status}` })
		}
	})

	it('maps network errors and timeouts to unreachable', async () => {
		const rejecting: typeof fetch = async () => {
			const err = new Error('timed out')
			err.name = 'TimeoutError'
			throw err
		}
		const r = await moderateRemote(PAYLOAD, bridge(rejecting))
		expect(r).toEqual({ status: 'unreachable', cause: 'TimeoutError' })
	})

	it('rejects non-JSON bodies as bad_json', async () => {
		const r = await moderateRemote(
			PAYLOAD,
			bridge(fetchStub(200, '<html>proxy error</html>')),
		)
		expect(r).toEqual({ status: 'unreachable', cause: 'bad_json' })
	})

	it('rejects malformed verdict shapes as bad_verdict', async () => {
		for (const body of [
			{ nope: 1 },
			{ verdict: 'maybe' },
			{ verdict: 'allow', publishText: 5 },
			{ verdict: 'reject', retryAfterMs: 'soon' },
		]) {
			const r = await moderateRemote(PAYLOAD, bridge(fetchStub(200, body)))
			expect(r).toEqual({ status: 'unreachable', cause: 'bad_verdict' })
		}
	})
})

describe('moderationBridge — env parsing (single source: env.ts)', () => {
	async function freshBridge(vars: Record<string, string | undefined>) {
		const prev: Record<string, string | undefined> = {}
		for (const [k, v] of Object.entries(vars)) {
			prev[k] = process.env[k]
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
		}
		vi.resetModules()
		const mod = await import(
			'../../infrastructure/gateways/moderation.gateway.js'
		)
		for (const [k, v] of Object.entries(prev)) {
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
		}
		return mod.moderationBridge()
	}

	it('returns null when MODERATION_SERVICE_URL is unset — chat is unchanged', async () => {
		expect(await freshBridge({ MODERATION_SERVICE_URL: undefined })).toBeNull()
	})

	it('strips trailing slashes so the endpoint never becomes //moderate', async () => {
		const b = await freshBridge({
			MODERATION_SERVICE_URL: 'http://mod.test///',
		})
		expect(b?.url).toBe('http://mod.test')
	})

	it('falls back to 1500ms when the timeout is empty or garbage', async () => {
		for (const bad of ['', 'abc', '0', '-5']) {
			const b = await freshBridge({
				MODERATION_SERVICE_URL: 'http://mod.test',
				MODERATION_TIMEOUT_MS: bad,
			})
			expect(b?.timeoutMs).toBe(1500)
		}
	})

	it('treats an unrecognized outage policy as off (fail closed)', async () => {
		const b = await freshBridge({
			MODERATION_SERVICE_URL: 'http://mod.test',
			MODERATION_OUTAGE_POLICY: 'preset',
		})
		expect(b?.outagePolicy).toBe('off')
	})
})

describe('processAndPublishMessage — moderation service branch', () => {
	function setupLobby(code = 'MODB') {
		const lobby = new Lobby(code, 'test_mod', 'host1')
		lobbies.set(code, lobby)
		const session = createSession('Host', {
			id: 'host1',
			tosAcceptedVersion: 1,
			chatEnabled: true,
		})
		lobby.addPlayer(session)
		return lobby
	}

	it('publishes when the service allows', async () => {
		const lobby = setupLobby()
		const r = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'hello there',
			bridge(fetchStub(200, { verdict: 'allow', band: 'clean' })),
		)
		expect(r).toEqual({ ok: true })
	})

	it('publishes the rewrite to MQTT but keeps the ORIGINAL in the evidence buffer', async () => {
		const lobby = setupLobby('MODG')
		vi.mocked(mqttService.publishChatMessage).mockClear()
		const r = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'suck my cock',
			bridge(
				fetchStub(200, {
					verdict: 'allow',
					band: 'clean',
					publishText: 'suck my cocktail',
				}),
			),
		)
		// Other players receive the rewrite...
		expect(mqttService.publishChatMessage).toHaveBeenCalledWith(
			'MODG',
			'host1',
			'Host',
			'suck my cocktail',
		)
		// ...the sender is told what was delivered...
		expect(r).toEqual({ ok: true, publishText: 'suck my cocktail' })
		// ...and the moderation evidence trail keeps what was actually typed.
		expect(lobby.messageBuffer.at(-1)?.message).toBe('suck my cock')
	})

	it('publishes the original when the verdict carries no rewrite', async () => {
		const lobby = setupLobby('MODH')
		vi.mocked(mqttService.publishChatMessage).mockClear()
		const r = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'hello there',
			bridge(fetchStub(200, { verdict: 'allow', band: 'clean' })),
		)
		expect(mqttService.publishChatMessage).toHaveBeenCalledWith(
			'MODH',
			'host1',
			'Host',
			'hello there',
		)
		expect(r).toEqual({ ok: true })
	})

	it('maps service rejections to reasons', async () => {
		const lobby = setupLobby('MODC')
		const r = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'bad message',
			bridge(fetchStub(200, { verdict: 'reject', band: 'blocklist' })),
		)
		expect(r).toEqual({ ok: false, reason: 'moderated' })

		const muted = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'hi',
			bridge(
				fetchStub(200, {
					verdict: 'reject',
					band: 'muted',
					mutedUntil: '2026-07-04T00:00:00Z',
				}),
			),
		)
		expect(muted).toEqual({
			ok: false,
			reason: 'muted',
			mutedUntil: '2026-07-04T00:00:00Z',
		})
	})

	it('maps a 429 shed to rate_limited', async () => {
		const lobby = setupLobby('MODS')
		const r = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'hi',
			bridge(fetchStub(429, { retryAfterMs: 2000 })),
		)
		expect(r).toEqual({ ok: false, reason: 'rate_limited', retryAfterMs: 2000 })
	})

	it('fails closed on outage with policy=off', async () => {
		const lobby = setupLobby('MODD')
		const r = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'hello',
			bridge(fetchStub(503, {})),
		)
		expect(r).toEqual({ ok: false, reason: 'moderation_unavailable' })
	})

	it('outage with policy=presets allows allowlisted, rejects free text', async () => {
		setConfig({ tosVersion: 0, mods: [], chatAllowlist: new Set(['gg']) })
		const lobby = setupLobby('MODE')
		const down = bridge(fetchStub(503, {}), { outagePolicy: 'presets' })

		const preset = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'GG!',
			down,
		)
		expect(preset).toEqual({ ok: true })

		const free = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'nice one',
			down,
		)
		expect(free).toEqual({ ok: false, reason: 'moderation_unavailable' })
	})

	it('legacy path unchanged when no bridge is configured', async () => {
		const lobby = setupLobby('MODF')
		const r = await processAndPublishMessage(
			lobby,
			'host1',
			'Host',
			'hello legacy',
			null,
		)
		expect(r).toEqual({ ok: true })
	})
})
