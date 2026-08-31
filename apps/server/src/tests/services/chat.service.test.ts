import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processAndPublishMessage } from '../../features/chat/chat.service.js'
import type { ModerationAttempt } from '../../features/chat/moderation.js'
import { normalizeForAllowlist } from '../../features/chat/normalization.js'
import { moderateMessage } from '../../features/chat/obscenity.js'
import { db } from '../../infrastructure/db/index.js'
import {
	callModerationService,
	isModerationBridgeEnabled,
} from '../../infrastructure/gateways/moderation.gateway.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { setConfig } from '../../state/config.js'
import { Lobby } from '../../state/lobby.js'

vi.mock('../../features/chat/obscenity.js', () => ({
	moderateMessage: vi.fn(),
}))

vi.mock('../../infrastructure/gateways/moderation.gateway.js', () => ({
	callModerationService: vi.fn(),
	isModerationBridgeEnabled: vi.fn(),
}))

const mockModerateMessage = vi.mocked(moderateMessage)
const mockCallModerationService = vi.mocked(callModerationService)
const mockIsModerationBridgeEnabled = vi.mocked(isModerationBridgeEnabled)

function makeLobby(): Lobby {
	return new Lobby('ABC123', 'mod1', 'host1')
}

describe('chat.service.processAndPublishMessage', () => {
	beforeEach(() => {
		mockModerateMessage.mockResolvedValue({ allowed: true })
		mockIsModerationBridgeEnabled.mockReturnValue(false)
	})

	describe('dormant (MODERATION_SERVICE_URL unset, the default)', () => {
		it('runs the legacy local obscenity path unchanged and publishes on allow', async () => {
			const lobby = makeLobby()

			const result = await processAndPublishMessage(
				lobby,
				'p1',
				'Alice',
				'hello there',
			)

			expect(result).toEqual({ ok: true })
			expect(mockModerateMessage).toHaveBeenCalledWith('hello there', 'p1')
			expect(mockCallModerationService).not.toHaveBeenCalled()
			expect(mqttService.publishChatMessage).toHaveBeenCalledWith(
				'ABC123',
				'p1',
				'Alice',
				'hello there',
			)
		})

		it('blocks with reason moderated when the local obscenity filter rejects it', async () => {
			mockModerateMessage.mockResolvedValue({ allowed: false })
			const lobby = makeLobby()

			const result = await processAndPublishMessage(
				lobby,
				'p1',
				'Alice',
				'bad word',
			)

			expect(result).toEqual({ ok: false, reason: 'moderated' })
			expect(mqttService.publishChatMessage).not.toHaveBeenCalled()
		})
	})

	describe('empty / allowlisted messages short-circuit regardless of moderation config', () => {
		it('returns reason empty for a message that normalizes to nothing', async () => {
			const lobby = makeLobby()
			const result = await processAndPublishMessage(lobby, 'p1', 'Alice', '   ')
			expect(result).toEqual({ ok: false, reason: 'empty' })
		})

		it('publishes an allowlisted message without calling either moderation path', async () => {
			const key = normalizeForAllowlist('gg')
			setConfig({
				tosVersion: 0,
				mods: [],
				chatAllowlist: new Set([key as string]),
			})
			const lobby = makeLobby()

			const result = await processAndPublishMessage(lobby, 'p1', 'Alice', 'gg')

			expect(result).toEqual({ ok: true })
			expect(mockModerateMessage).not.toHaveBeenCalled()
			expect(mockCallModerationService).not.toHaveBeenCalled()
			expect(mqttService.publishChatMessage).toHaveBeenCalledWith(
				'ABC123',
				'p1',
				'Alice',
				'gg',
			)
		})
	})

	// The full allow/reject/band decision matrix (moderated, unavailable,
	// unknown bands, ...) is asserted once, against
	// the pure core, in moderation.test.ts. These tests cover only what's
	// specific to this wiring: which path runs, and what gets published vs.
	// kept in evidence.
	describe('configured (MODERATION_SERVICE_URL set)', () => {
		function mockAttempt(attempt: ModerationAttempt) {
			mockCallModerationService.mockResolvedValue(attempt)
		}

		beforeEach(() => {
			mockIsModerationBridgeEnabled.mockReturnValue(true)
		})

		it('publishes the original text on allow', async () => {
			mockAttempt({ status: 200, body: { verdict: 'allow' } })
			const lobby = makeLobby()

			const result = await processAndPublishMessage(
				lobby,
				'p1',
				'Alice',
				'hello there',
			)

			expect(result).toEqual({ ok: true })
			// No displayName: the service has no use for a player's name.
			expect(mockCallModerationService).toHaveBeenCalledWith({
				playerId: 'p1',
				lobbyCode: 'ABC123',
				message: 'hello there',
				context: [],
			})
			expect(mqttService.publishChatMessage).toHaveBeenCalledWith(
				'ABC123',
				'p1',
				'Alice',
				'hello there',
			)
		})

		it('publishes the rewrite from publishText, but keeps the original in the evidence buffer and report DB', async () => {
			mockAttempt({
				status: 200,
				body: { verdict: 'allow', publishText: '**** you' },
			})
			const lobby = makeLobby()
			lobby.isReported = true
			const valuesMock = vi.fn().mockResolvedValue(undefined)
			vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as never)

			const result = await processAndPublishMessage(
				lobby,
				'p1',
				'Alice',
				'fuck you',
			)

			// The sender is told what was actually delivered, so the client can
			// show "sent as ..." instead of the rewrite being silent.
			expect(result).toEqual({ ok: true, publishText: '**** you' })
			// MQTT gets the rewritten text...
			expect(mqttService.publishChatMessage).toHaveBeenCalledWith(
				'ABC123',
				'p1',
				'Alice',
				'**** you',
			)
			// ...but the in-memory evidence buffer keeps the original typed text
			expect(lobby.messageBuffer.at(-1)?.message).toBe('fuck you')
			// ...and so does the reported-lobby DB row
			expect(valuesMock).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'fuck you' }),
			)
		})

		it('fails closed as unavailable on a transport failure, and never publishes', async () => {
			mockAttempt(null)
			const lobby = makeLobby()

			const result = await processAndPublishMessage(lobby, 'p1', 'Alice', 'hi')

			expect(result).toEqual({ ok: false, reason: 'unavailable' })
			expect(mqttService.publishChatMessage).not.toHaveBeenCalled()
		})

		it('never calls the local obscenity filter once configured', async () => {
			mockAttempt({ status: 200, body: { verdict: 'allow' } })
			const lobby = makeLobby()

			await processAndPublishMessage(lobby, 'p1', 'Alice', 'hi')

			expect(mockModerateMessage).not.toHaveBeenCalled()
		})

		it('allowlisted messages never reach the remote service either', async () => {
			const key = normalizeForAllowlist('gg')
			setConfig({
				tosVersion: 0,
				mods: [],
				chatAllowlist: new Set([key as string]),
			})
			const lobby = makeLobby()

			const result = await processAndPublishMessage(lobby, 'p1', 'Alice', 'gg')

			expect(result).toEqual({ ok: true })
			expect(mockCallModerationService).not.toHaveBeenCalled()
		})

		it("blocks rather than publishing or echoing a rewrite over the relay's own 500-char cap", async () => {
			mockAttempt({
				status: 200,
				body: { verdict: 'allow', publishText: 'x'.repeat(501) },
			})
			const lobby = makeLobby()

			const result = await processAndPublishMessage(lobby, 'p1', 'Alice', 'hi')

			expect(result).toEqual({ ok: false, reason: 'moderated' })
			expect(mqttService.publishChatMessage).not.toHaveBeenCalled()
		})

		describe('context passed to the moderation service', () => {
			it('sends the lobby buffer as context, oldest-first, mapping sender vs. other', async () => {
				mockAttempt({ status: 200, body: { verdict: 'allow' } })
				const lobby = makeLobby()
				const sentAt = new Date()
				lobby.bufferMessage({
					playerId: 'p2',
					displayName: 'Bob',
					message: 'gg',
					sentAt,
				})
				lobby.bufferMessage({
					playerId: 'p1',
					displayName: 'Alice',
					message: 'ready?',
					sentAt,
				})

				await processAndPublishMessage(lobby, 'p1', 'Alice', 'hello there')

				expect(mockCallModerationService).toHaveBeenCalledWith({
					playerId: 'p1',
					lobbyCode: 'ABC123',
					message: 'hello there',
					context: [
						{ who: 'other', text: 'gg' },
						{ who: 'sender', text: 'ready?' },
					],
				})
			})

			it('caps context to the last 8 buffered messages', async () => {
				mockAttempt({ status: 200, body: { verdict: 'allow' } })
				const lobby = makeLobby()
				for (let i = 0; i < 12; i++) {
					lobby.bufferMessage({
						playerId: 'p2',
						displayName: 'Bob',
						message: `msg ${i}`,
						sentAt: new Date(),
					})
				}

				await processAndPublishMessage(lobby, 'p1', 'Alice', 'hello there')

				const call = mockCallModerationService.mock.calls.at(-1)?.[0]
				expect(call?.context).toHaveLength(8)
				expect(call?.context?.[0]).toEqual({ who: 'other', text: 'msg 4' })
				expect(call?.context?.at(-1)).toEqual({
					who: 'other',
					text: 'msg 11',
				})
			})
		})

		// The remote service logs no message content by design, so this is the
		// only place a remotely-blocked message is preserved as evidence.
		describe('evidence for a remote block', () => {
			it('records a moderated block with the band and the original typed text', async () => {
				mockAttempt({
					status: 200,
					body: { verdict: 'reject', band: 'threat_block' },
				})
				const lobby = makeLobby()
				const valuesMock = vi.fn().mockResolvedValue(undefined)
				vi.mocked(db.insert).mockReturnValueOnce({
					values: valuesMock,
				} as never)

				const result = await processAndPublishMessage(
					lobby,
					'p1',
					'Alice',
					'bad message',
				)

				expect(result).toEqual({ ok: false, reason: 'moderated' })
				expect(valuesMock).toHaveBeenCalledWith(
					expect.objectContaining({
						playerId: 'p1',
						message: 'bad message',
						matches: { source: 'remote', band: 'threat_block' },
					}),
				)
			})

			it('does not write evidence for an unavailable block', async () => {
				mockAttempt(null)
				const lobby = makeLobby()

				await processAndPublishMessage(lobby, 'p1', 'Alice', 'hi')

				expect(db.insert).not.toHaveBeenCalled()
			})

			it('still blocks the message when the evidence write itself fails', async () => {
				mockAttempt({
					status: 200,
					body: { verdict: 'reject', band: 'threat_block' },
				})
				const lobby = makeLobby()
				vi.mocked(db.insert).mockImplementationOnce(() => {
					throw new Error('db unavailable')
				})

				const result = await processAndPublishMessage(
					lobby,
					'p1',
					'Alice',
					'bad message',
				)

				expect(result).toEqual({ ok: false, reason: 'moderated' })
			})
		})
	})
})
