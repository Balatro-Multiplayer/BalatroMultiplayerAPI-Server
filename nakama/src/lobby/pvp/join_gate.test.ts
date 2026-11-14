// A join to a PvP lobby needs MultiplayerPvP 1.1.0+, from the mod report the
// server stores; any other mod's lobby never asks (docs/pvp-match.md section 1).
import { describe, expect, it } from 'vitest'
import {
	PVP_MOD_ID,
	PVP_UPDATE_REQUIRED_MESSAGE,
} from '../../standing/pvp_version'
import { writeModReport } from '../../standing/storage'
import { fakeLogger, fakeNk, playerCtx } from '../../testing/fake_nk'
import {
	type LobbyMatchState,
	lobbyMatchInit,
	lobbyMatchJoin,
	lobbyMatchJoinAttempt,
} from '../match'
import { SPECTATOR_ROLE } from '../spectate'
import { DIFFERENT_MOD } from '../state'

const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context
const dispatcher = {
	broadcastMessage: () => undefined,
	matchKick: () => undefined,
	matchLabelUpdate: () => undefined,
} as unknown as nkruntime.MatchDispatcher
const presence = (userId: string) =>
	({
		userId,
		sessionId: `${userId}-s`,
		username: userId,
		node: 'n',
	}) as nkruntime.Presence

function harness(modId: string) {
	const nk = fakeNk({
		accountGetId: (id: string) => ({ user: { userId: id, username: id } }),
		matchGet: () => null,
	}) as unknown as nkruntime.Nakama
	const state = lobbyMatchInit(ctx, fakeLogger, nk, {
		code: 'GATE1',
		modId,
		maxPlayers: 4,
		creatorId: 'host',
	}).state as LobbyMatchState
	const tryJoin = (
		userId: string,
		mods: string[] | null,
		joinModId = modId,
		from = state,
	) => {
		if (mods) writeModReport(nk, userId, { mods, reportedAt: 0 })
		return lobbyMatchJoinAttempt(
			ctx,
			fakeLogger,
			nk,
			dispatcher,
			1,
			from,
			presence(userId),
			{ modId: joinModId },
		)
	}
	return { nk, state, tryJoin }
}

describe('the PvP version gate on join', () => {
	it.each([
		['no mod report', null],
		['PvP not reported', ['Steamodded-1.0.0']],
		['unreadable version', [`${PVP_MOD_ID}-UNK`]],
		['1.0.5', [`${PVP_MOD_ID}-1.0.5`]],
	])('refuses %s with the update text', (_name, mods) => {
		const attempt = harness(PVP_MOD_ID).tryJoin('host', mods)
		expect(attempt.accept).toBe(false)
		expect(attempt.rejectMessage).toBe(PVP_UPDATE_REQUIRED_MESSAGE)
	})

	it.each(['1.1.0', '1.2.0'])('admits %s', (version) => {
		const attempt = harness(PVP_MOD_ID).tryJoin('host', [
			`${PVP_MOD_ID}-${version}`,
		])
		expect(attempt.rejectMessage).toBeUndefined()
	})

	it('admits a client with no pvpVersion to a Speedrunning lobby', () => {
		const attempt = harness('MultiplayerSPDRN').tryJoin('host', [
			'MultiplayerAPI-1.0.6',
		])
		expect(attempt.rejectMessage).toBeUndefined()
	})

	it('still tells a Speedrunning client the lobby is another mod', () => {
		const attempt = harness(PVP_MOD_ID).tryJoin(
			'host',
			['MultiplayerAPI-1.0.6'],
			'MultiplayerSPDRN',
		)
		expect(attempt.accept).toBe(false)
		expect(attempt.rejectMessage).toBe(DIFFERENT_MOD)
	})

	it('gates an old client coming back to its own seat', () => {
		const { nk, state, tryJoin } = harness(PVP_MOD_ID)
		const fresh = tryJoin('host', [`${PVP_MOD_ID}-1.1.0`])
		expect(fresh.accept).toBe(true)
		const joined = lobbyMatchJoin(
			ctx,
			fakeLogger,
			nk,
			dispatcher,
			2,
			fresh.state as LobbyMatchState,
			[presence('host')],
		)
		if (!joined) throw new Error('join stopped the match')
		const seated = joined.state
		expect(seated.lobby.players.map((p) => p.id)).toEqual(['host'])
		expect(state.lobby.players).toEqual([])
		writeModReport(nk, 'host', { mods: [`${PVP_MOD_ID}-1.0.5`], reportedAt: 0 })
		const back = tryJoin('host', null, PVP_MOD_ID, seated)
		expect(back.accept).toBe(false)
		expect(back.rejectMessage).toBe(PVP_UPDATE_REQUIRED_MESSAGE)
	})

	it.each([
		['no mod report', null, false],
		['1.0.5', [`${PVP_MOD_ID}-1.0.5`], false],
		['1.1.0', [`${PVP_MOD_ID}-1.1.0`], true],
	])('gates a spectator: %s', (_name, mods, admitted) => {
		const { nk, state } = harness(PVP_MOD_ID)
		if (mods) writeModReport(nk, 'watcher', { mods, reportedAt: 0 })
		const open = {
			...state,
			lobby: { ...state.lobby, metadata: { ...state.lobby.metadata, spectatable: true } },
		}
		const attempt = lobbyMatchJoinAttempt(ctx, fakeLogger, nk, dispatcher, 1, open, presence('watcher'), {
			modId: PVP_MOD_ID,
			role: SPECTATOR_ROLE,
		})
		expect(attempt.accept).toBe(admitted)
		if (!admitted) expect(attempt.rejectMessage).toBe(PVP_UPDATE_REQUIRED_MESSAGE)
	})
})
