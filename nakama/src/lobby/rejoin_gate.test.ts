import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { verdictRecord, writeIntegrity } from '../integrity'
import { REJOIN_REFUSED_PREFIX } from '../standing/rejoin'
import { writeModReport } from '../standing/storage'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { lobbyMatchInit, lobbyMatchJoin, lobbyMatchJoinAttempt, lobbyMatchLeave, type LobbyMatchState } from './match'

// A matchmade game's players must come back with the standing it was queued
// with (Lobby.requiredStanding); a private lobby never asks.
function lobbyNk() {
	const nk = fakeNk({
		accountGetId: (id: string) => ({ user: { userId: id, username: id } }),
		matchGet: () => null,
	}) as any
	writeConfig(nk, { ...DEFAULT_CONFIG, queueAllowedModIds: ['MultiplayerAPI'] })
	return nk as nkruntime.Nakama
}

const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context
const presence = (userId: string) =>
	({ userId, sessionId: `${userId}-s`, username: userId, node: 'n' }) as nkruntime.Presence
const dispatcher = {
	broadcastMessage: () => undefined,
	matchKick: () => undefined,
	matchLabelUpdate: () => undefined,
} as unknown as nkruntime.MatchDispatcher
const report = (nk: nkruntime.Nakama, userId: string, mods: string[]) =>
	writeModReport(nk, userId, { mods, reportedAt: 0 })

function matchmade(nk: nkruntime.Nakama, requiredStanding: string) {
	return lobbyMatchInit(ctx, fakeLogger, nk, {
		code: 'MATCH1',
		modId: 'M',
		maxPlayers: 2,
		creatorId: 'a',
		allowedIds: 'a,b',
		gameMode: 'standard',
		requiredStanding,
	}).state as LobbyMatchState
}

function attempt(nk: nkruntime.Nakama, state: LobbyMatchState, userId: string) {
	return lobbyMatchJoinAttempt(ctx, fakeLogger, nk, dispatcher, 1, state, presence(userId), { modId: 'M' })
}

function seated(nk: nkruntime.Nakama, state: LobbyMatchState, userId: string): LobbyMatchState {
	const tried = attempt(nk, state, userId)
	expect(tried.accept).toBe(true)
	return lobbyMatchJoin(ctx, fakeLogger, nk, dispatcher, 2, tried.state as LobbyMatchState, [presence(userId)])!.state
}

const refusalOf = (message: string | undefined) => {
	expect(message!.indexOf(REJOIN_REFUSED_PREFIX)).toBe(0)
	return JSON.parse(message!.slice(REJOIN_REFUSED_PREFIX.length))
}

describe('the matchmade rejoin gate', () => {
	it('refuses a returning player with disallowed mods, keeps the seat, and lets them back once fixed', () => {
		const nk = lobbyNk()
		report(nk, 'a', ['MultiplayerAPI-0.1.2'])
		report(nk, 'b', ['MultiplayerAPI-0.1.2'])
		let state = seated(nk, seated(nk, matchmade(nk, 'valid'), 'a'), 'b')
		state = lobbyMatchLeave(ctx, fakeLogger, nk, dispatcher, 3, state, [presence('a')])!.state

		report(nk, 'a', ['MultiplayerAPI-0.1.2', 'Cryptid-0.5.3'])
		const refused = attempt(nk, state, 'a')
		expect(refused.accept).toBe(false)
		expect(refusalOf(refused.rejectMessage)).toMatchObject({ reason: 'mods_not_allowed', mods: ['Cryptid'] })
		// Still seated, still away: the grace period runs on.
		const seat = state.lobby.players.find((p) => p.id === 'a')!
		expect(seat.awaySince).not.toBeNull()

		report(nk, 'a', ['MultiplayerAPI-0.1.2'])
		expect(attempt(nk, state, 'a').accept).toBe(true)
	})

	it('wants a report from this session', () => {
		const nk = lobbyNk()
		expect(refusalOf(attempt(nk, matchmade(nk, 'valid'), 'b').rejectMessage).reason).toBe('mods_unreported')
	})

	it('wants a launcher verdict for a ranked game, whatever the mods', () => {
		const nk = lobbyNk()
		report(nk, 'a', ['MultiplayerAPI-0.1.2'])
		const state = matchmade(nk, 'verified')
		expect(refusalOf(attempt(nk, state, 'a').rejectMessage)).toEqual({
			reason: 'verification_pending',
			mods: [],
			message: 'Launcher verification is still pending. Try again in a moment.',
		})
		report(nk, 'a', ['Cryptid-0.5.3'])
		writeIntegrity(nk, 'a', verdictRecord(true, true, 0))
		expect(attempt(nk, state, 'a').accept).toBe(true)
	})

	it('says a failed verdict is final for a ranked game', () => {
		const nk = lobbyNk()
		report(nk, 'a', ['MultiplayerAPI-0.1.2'])
		writeIntegrity(nk, 'a', verdictRecord(false, false, 0, 'refused'))
		expect(refusalOf(attempt(nk, matchmade(nk, 'verified'), 'a').rejectMessage).reason).toBe('verification_failed')
	})

	it('never gates a private lobby', () => {
		const nk = lobbyNk()
		const state = lobbyMatchInit(ctx, fakeLogger, nk, { code: 'PRIV01', modId: 'M', maxPlayers: 4, creatorId: 'a' })
			.state as LobbyMatchState
		expect(attempt(nk, state, 'a').accept).toBe(true)
	})

	it("shows each player's standing, worked out by the server, in the lobby", () => {
		const nk = lobbyNk()
		report(nk, 'a', ['MultiplayerAPI-0.1.2'])
		const state = seated(nk, lobbyMatchInit(ctx, fakeLogger, nk, { code: 'PRIV02', modId: 'M', maxPlayers: 4, creatorId: 'a' }).state as LobbyMatchState, 'a')
		expect(state.lobby.players[0].info.standing).toBe('valid')
	})
})
