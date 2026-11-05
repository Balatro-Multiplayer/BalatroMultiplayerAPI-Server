import { describe, expect, it } from 'vitest'
import { banNameOf } from '../../../packages/types/src/ban-name'
import { CURRENT_LOBBY_COLLECTION, CURRENT_LOBBY_KEY, RATINGS_COLLECTION } from '../lobby/protocol'
import { NotificationKind } from '../notification/kinds'
import { listNotifications } from '../notification/store'
import { defaultProfile, playerView, shownNameOf, writeProfile } from '../player/profile'
import { fakeLogger, fakeNk } from '../testing/fake_nk'
import { readBans } from './bans'
import { applyBan, liftBan } from './enforce'

const U = '0b9d4a52-77c1-4e0f-9a3d-1c2e3f405162'
const BOARD = 'pvp:ranked:3'

// One player with a Discord name, a lobby seat and a rated board entry.
function world() {
	const lobbySignals: any[] = []
	const records: { board: string; owner: string; name: string; score: number }[] = []
	const accountNames: string[] = []
	const nk = fakeNk({
		accountGetId: () => ({ user: { id: U, displayName: 'old' }, customId: '1', devices: [] }),
		accountUpdateId: (_id: string, _u: unknown, displayName: string) => accountNames.push(displayName),
		matchGet: (matchId: string) => ({ matchId }),
		matchSignal: (_matchId: string, data: string) => {
			const signal = JSON.parse(data)
			if (signal.type === 'has_player') return 'yes'
			lobbySignals.push(signal)
			return ''
		},
		leaderboardCreate: () => undefined,
		leaderboardRecordWrite: (board: string, owner: string, name: string, score: number) => {
			records.push({ board, owner, name, score })
		},
		leaderboardRecordDelete: () => undefined,
	})
	writeProfile(nk as any, U, {
		...defaultProfile('RealSteam'),
		useDiscordName: true,
		discordIdHash: 'h',
		discordUsername: 'RealDiscord',
		nakamaLogin: true,
	})
	nk.storageWrite([
		{ collection: CURRENT_LOBBY_COLLECTION, key: CURRENT_LOBBY_KEY, userId: U, value: { matchId: 'm1', code: 'ABC123', modId: 'M' } },
		{
			collection: RATINGS_COLLECTION,
			key: BOARD,
			userId: U,
			value: { rating: 1400, wins: 9, losses: 3, gamesPlayed: 12, seasonBest: null, lastMatchAt: 1 },
		},
	])
	return { nk: nk as any, lobbySignals, records, accountNames }
}

const ban = (id = 'u1') => ({ banId: id, expiresAt: null, reason: '' })

describe('the shown name', () => {
	it('is the player own pick without a username ban, and the Ban name with one', () => {
		const { nk } = world()
		const profile = () => JSON.parse(JSON.stringify(nk.storageRead([{ collection: 'player', key: 'profile', userId: U }])[0].value))
		expect(shownNameOf(nk, U, profile())).toBe('RealDiscord')
		applyBan(nk, fakeLogger, U, 'username', ban())
		expect(shownNameOf(nk, U, profile())).toBe(banNameOf(U))
		liftBan(nk, fakeLogger, U, 'u1')
		expect(shownNameOf(nk, U, profile())).toBe('RealDiscord')
	})

	it('ignores a Steam name change and the Steam or Discord choice while the ban lasts', () => {
		const { nk } = world()
		applyBan(nk, fakeLogger, U, 'username', ban())
		const changed = { ...defaultProfile('NewSteamName'), useDiscordName: false }
		expect(shownNameOf(nk, U, changed)).toBe(banNameOf(U))
		expect(playerView(nk, U, changed)).toMatchObject({ displayName: banNameOf(U), usernameBanned: true })
	})

	it('gives the same Ban name as the shared rule, for the same id', () => {
		expect(banNameOf(U)).toBe('Ghost Burnt')
	})
})

describe('putting a username ban in force', () => {
	it('records it, pushes no BANNED, and refuses nothing', () => {
		const { nk } = world()
		applyBan(nk, fakeLogger, U, 'username', ban())
		expect(readBans(nk, U).username?.banId).toBe('u1')
		expect(nk.notifications.filter((n: any) => n.code === 102)).toEqual([])
	})

	it('tells the player once, with the Ban name', () => {
		const { nk } = world()
		applyBan(nk, fakeLogger, U, 'username', ban())
		applyBan(nk, fakeLogger, U, 'username', ban())
		const sent = listNotifications(nk, U).filter((n) => n.kind === NotificationKind.USERNAME_BANNED)
		expect(sent).toHaveLength(1)
		expect(sent[0].params).toEqual({ banName: 'Ghost Burnt' })
	})

	it('moves the seat in the lobby, the account name and the leaderboard entry to the Ban name', () => {
		const { nk, lobbySignals, records, accountNames } = world()
		applyBan(nk, fakeLogger, U, 'username', ban())
		expect(lobbySignals).toContainEqual({ type: 'player_info', userId: U, info: expect.objectContaining({ displayName: 'Ghost Burnt' }) })
		expect(accountNames).toEqual(['Ghost Burnt'])
		expect(records).toEqual([{ board: BOARD, owner: U, name: 'Ghost Burnt', score: 1400 }])
	})
})

describe('lifting a username ban', () => {
	it('gives the real name back to the seat, the account and the leaderboard', () => {
		const { nk, lobbySignals, records, accountNames } = world()
		applyBan(nk, fakeLogger, U, 'username', ban())
		liftBan(nk, fakeLogger, U, 'u1')
		expect(lobbySignals[lobbySignals.length - 1]).toMatchObject({ info: { displayName: 'RealDiscord' } })
		expect(accountNames[accountNames.length - 1]).toBe('RealDiscord')
		expect(records[records.length - 1]).toMatchObject({ board: BOARD, name: 'RealDiscord' })
	})

	it('leaves names alone when another ban is lifted', () => {
		const { nk, records } = world()
		applyBan(nk, fakeLogger, U, 'chat', ban('c1'))
		liftBan(nk, fakeLogger, U, 'c1')
		expect(records).toEqual([])
	})
})
