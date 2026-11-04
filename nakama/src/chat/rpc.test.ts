import { describe, expect, it } from 'vitest'
import { NOTICE_VERSION } from '../../../packages/types/src/notice'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { defaultProfile, writeProfile, type Profile } from '../player/profile'
import { CURRENT_LOBBY_COLLECTION, CURRENT_LOBBY_KEY } from '../lobby/protocol'
import { MIRROR_COLLECTION } from '../mirror/outbox'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { rpcChatEnable, rpcChatSend } from './rpc'

const USER = '11111111-1111-4111-8111-111111111111'

function nkWith(profile: Partial<Profile>, config = {}) {
	const nk = fakeNk()
	writeConfig(nk as any, { ...DEFAULT_CONFIG, ...config })
	writeProfile(nk as any, USER, { ...defaultProfile('Alice'), ...profile })
	return nk
}

const enable = (nk: unknown) => JSON.parse(rpcChatEnable(playerCtx(USER), fakeLogger, nk as any, '{}'))
const send = (nk: unknown) => rpcChatSend(playerCtx(USER), fakeLogger, nk as any, JSON.stringify({ message: 'hi' }))

describe('chat_enable', () => {
	it('turns chat on once the current Notice is accepted', () => {
		const nk = nkWith({ tosAcceptedVersion: NOTICE_VERSION })
		expect(enable(nk).player.chatEnabled).toBe(true)
	})

	it('waits for the current Notice', () => {
		expect(() => enable(nkWith({ tosAcceptedVersion: NOTICE_VERSION - 1 }))).toThrow(/Accept the Notice/)
	})

	it('refuses a chat-blocked account', () => {
		expect(() => enable(nkWith({ tosAcceptedVersion: NOTICE_VERSION, chatBlocked: true }))).toThrow(/restricted/)
	})
})

describe('chat on a Community server (no Notice)', () => {
	const COMMUNITY = { BMP_SERVER_KIND: 'community' }
	const enableOn = (nk: unknown) => JSON.parse(rpcChatEnable(playerCtx(USER, COMMUNITY), fakeLogger, nk as any, '{}'))
	const sendOn = (nk: unknown) => rpcChatSend(playerCtx(USER, COMMUNITY), fakeLogger, nk as any, JSON.stringify({ message: 'hi' }))

	it('turns chat on once the age is answered, without the Notice', () => {
		expect(enableOn(nkWith({ ageAnswered: true })).player.chatEnabled).toBe(true)
	})

	it('waits for the age answer', () => {
		expect(() => enableOn(nkWith({}))).toThrow(/age/)
		expect(() => sendOn(nkWith({ chatEnabled: true }))).toThrow(/age/)
	})

	it('keeps chat off for an under-16 answer', () => {
		expect(() => enableOn(nkWith({ ageAnswered: true, chatBlocked: true }))).toThrow(/restricted/)
	})

	it('lets an enabled player through to the lobby check', () => {
		expect(() => sendOn(nkWith({ ageAnswered: true, chatEnabled: true }))).toThrow(/Not in a lobby/)
	})
})

describe('chat_send gates', () => {
	it('refuses when chat is off server-wide', () => {
		const nk = nkWith({ tosAcceptedVersion: NOTICE_VERSION, chatEnabled: true }, { chatEnabled: false })
		expect(() => send(nk)).toThrow(/turned off/)
	})

	it('refuses players without chat enabled', () => {
		expect(() => send(nkWith({ tosAcceptedVersion: NOTICE_VERSION }))).toThrow(/not enabled/)
		expect(() => send(nkWith({ tosAcceptedVersion: NOTICE_VERSION, chatEnabled: true, chatBlocked: true }))).toThrow(/not enabled/)
	})

	it('refuses after a ToS update until it is accepted', () => {
		expect(() => send(nkWith({ tosAcceptedVersion: NOTICE_VERSION - 1, chatEnabled: true }))).toThrow(/Accept the Notice/)
	})

	it('lets an enabled player through to the lobby check', () => {
		expect(() => send(nkWith({ tosAcceptedVersion: NOTICE_VERSION, chatEnabled: true }))).toThrow(/Not in a lobby/)
	})
})

// Seated in lobby ABCDEF; the moderation service answers with verdict.
function seated(verdict: unknown, config = {}) {
	const nk = nkWith({ tosAcceptedVersion: NOTICE_VERSION, ageAnswered: true, chatEnabled: true }, config)
	let next = 0
	nk.uuidv4 = () => `u${++next}`
	nk.matchGet = () => ({})
	nk.posted = [] as string[]
	nk.matchSignal = (_id: string, data: string) => {
		const signal = JSON.parse(data)
		if (signal.type === 'has_player') return 'yes'
		if (signal.type === 'chat_check') return JSON.stringify({ code: 'ABCDEF', context: [] })
		if (signal.type === 'chat_post') nk.posted.push(signal.text)
		return 'ok'
	}
	nk.httpRequest = (url: string, method: string, headers: any, body: string) => {
		nk.http.push({ url, method, headers, body })
		return { code: 200, headers: {}, body: JSON.stringify(verdict) }
	}
	nk.storageWrite([{ collection: CURRENT_LOBBY_COLLECTION, key: CURRENT_LOBBY_KEY, userId: USER, value: { matchId: 'm1', code: 'ABCDEF', modId: 'M' } }])
	return nk
}

const say = (nk: unknown, message: string, env = {}) =>
	JSON.parse(rpcChatSend(playerCtx(USER, env), fakeLogger, nk as any, JSON.stringify({ message })))
const logged = (nk: any) =>
	[...nk.objects.entries()].filter(([k]: [string]) => k.startsWith(MIRROR_COLLECTION + '/')).map(([, o]: any) => o.value.line)

describe('chat_send moderation', () => {
	it('posts an allowed message as typed and logs it', () => {
		// A publishText from an older service is ignored: chat is never rewritten.
		const nk = seated({ verdict: 'allow', publishText: 'h*llo' })
		expect(say(nk, 'hello')).toEqual({ text: 'hello' })
		expect(nk.posted).toEqual(['hello'])
		expect(logged(nk)).toEqual([{ lobbyCode: 'ABCDEF', lobbyId: 'm1', lobbyKind: null, userId: USER, message: 'hello', flagged: false, verdict: null }])
	})

	it('logs a blocked message with its band, and posts nothing', () => {
		const nk = seated({ verdict: 'reject', band: 'high' })
		expect(() => say(nk, 'bad words')).toThrow(/blocked/)
		expect(nk.posted).toEqual([])
		expect(logged(nk)).toEqual([
			{ lobbyCode: 'ABCDEF', lobbyId: 'm1', lobbyKind: null, userId: USER, message: 'bad words', flagged: true, verdict: { source: 'remote', band: 'high' } },
		])
	})

	it('posts a message the service marks for review, and flags it so a moderator sees it', () => {
		const nk = seated({ verdict: 'allow', band: 'review' })
		expect(say(nk, 'borderline')).toEqual({ text: 'borderline' })
		expect(nk.posted).toEqual(['borderline'])
		expect(logged(nk)).toEqual([
			{ lobbyCode: 'ABCDEF', lobbyId: 'm1', lobbyKind: null, userId: USER, message: 'borderline', flagged: true, verdict: { source: 'remote', band: 'review' } },
		])
	})

	it('logs nothing it could not judge', () => {
		const nk = seated({ verdict: 'reject', band: 'guard_unavailable' })
		expect(() => say(nk, 'hello')).toThrow(/unavailable/)
		expect(logged(nk)).toEqual([])
	})

	it('logs the guard score of an allowed message without flagging it', () => {
		const nk = seated({ verdict: 'allow', band: 'clean', guardSafety: 'Safe', guardScore: 0.02, guardContextUsed: false })
		say(nk, 'nice hand')
		expect(logged(nk)).toEqual([
			{
				lobbyCode: 'ABCDEF',
				lobbyId: 'm1',
				lobbyKind: null,
				userId: USER,
				message: 'nice hand',
				flagged: false,
				verdict: { source: 'remote', band: 'clean', guardSafety: 'Safe', guardScore: 0.02, guardContextUsed: false },
			},
		])
	})

	it('logs the guard score of a blocked message', () => {
		const nk = seated({ verdict: 'reject', band: 'high', guardSafety: 'Unsafe', guardScore: 0.97, guardContextUsed: true })
		expect(() => say(nk, 'bad words')).toThrow(/blocked/)
		expect(logged(nk)[0].verdict).toEqual({ source: 'remote', band: 'high', guardSafety: 'Unsafe', guardScore: 0.97, guardContextUsed: true })
	})

	it('logs the guard score of a message published for review', () => {
		const nk = seated({ verdict: 'allow', band: 'review', guardSafety: 'Controversial', guardScore: 0.5, guardContextUsed: false })
		say(nk, 'borderline')
		const [line] = logged(nk)
		expect(line.flagged).toBe(true)
		expect(line.verdict).toEqual({ source: 'remote', band: 'review', guardSafety: 'Controversial', guardScore: 0.5, guardContextUsed: false })
	})

	it('skips the service for an allowlisted message', () => {
		const nk = seated({ verdict: 'reject', band: 'high' }, { chatAllowlist: ['good game'] })
		expect(say(nk, 'Good game!')).toEqual({ text: 'Good game!' })
		expect(nk.http).toEqual([])
	})

	it('falls back to the word filter with the service switched off', () => {
		const nk = seated({ verdict: 'reject', band: 'high' })
		const off = { MODERATION_REMOTE: 'off' }
		expect(say(nk, 'nice hand', off)).toEqual({ text: 'nice hand' })
		expect(() => say(nk, 'what the fuck', off)).toThrow(/blocked/)
		expect(nk.http).toEqual([])
		const [, blocked] = logged(nk)
		expect(blocked.verdict).toEqual({ source: 'local', matches: [{ word: 'fuck', startIndex: 9, endIndex: 12 }] })
	})

	it('works on a Community server without the moderation service', () => {
		const nk = seated({ verdict: 'reject', band: 'guard_unavailable' })
		const community = { BMP_SERVER_KIND: 'community' }
		expect(say(nk, 'nice hand', community)).toEqual({ text: 'nice hand' })
		expect(() => say(nk, 'what the fuck', community)).toThrow(/blocked/)
		expect(nk.http).toEqual([])
	})
})
