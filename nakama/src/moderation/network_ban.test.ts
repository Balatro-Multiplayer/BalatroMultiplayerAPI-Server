// Network bans end to end through the hooks and admin RPCs that carry them:
// a login records its network, a permanent account ban bans the networks,
// and a later login from one of them is refused until an admin lifts it.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { rpcAdminBanApply } from '../admin'
import {
	afterAuthenticateCustom,
	beforeAuthenticateCustom,
	beforeSessionRefresh,
} from '../auth'
import { fakeLogger, fakeNk } from '../testing/fake_nk'
import {
	rpcAdminIpHashesPurge,
	rpcAdminNetworkCheck,
	rpcAdminNetworkBanLift,
	rpcAdminNetworkBans,
	rpcAdminPlayerNetworks,
} from './network_admin'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const STEAM_A = '76561198000000001'
const STEAM_B = '76561198000000002'
// Documentation ranges (RFC 5737, RFC 3849) only.
const HOME = '192.0.2.10'
const CAFE = '198.51.100.20'
const HOME_V6 = '2001:db8:1:2::10'
const DAY = 24 * 60 * 60 * 1000

type Kind = 'official' | 'community' | 'dev'

function world(kind: Kind = 'official', salt = 'test-salt') {
	const env = {
		BMP_SERVER_KIND: kind,
		STEAM_WEB_API_KEY: 'k',
		IP_HASH_SALT: salt,
		PLAYER_ID_SALT: 'player-salt',
	}
	const accounts: { [id: string]: string } = { [A]: STEAM_A, [B]: STEAM_B }
	let steamIdForTicket = STEAM_A
	const nk = fakeNk({
		accountGetId: (id: string) => ({
			user: { id, username: id },
			// As Steam login names it (player/steam_id.ts).
			customId: `steamhash:${createHash('sha256')
				.update(`${accounts[id]}player-salt`)
				.digest('hex')}`,
			devices: [],
		}),
		usersBanId: () => undefined,
		usersUnbanId: () => undefined,
		httpRequest: () => ({
			code: 200,
			headers: {},
			body: JSON.stringify({
				response: { params: { result: 'OK', steamid: steamIdForTicket } },
			}),
		}),
		sha256Hash: (input: string) =>
			createHash('sha256').update(input).digest('hex'),
	})
	const ctx = (userId: string, clientIp: string) =>
		({ userId, username: '', matchId: '', env, clientIp }) as any
	const serverCall = { userId: '', username: '', matchId: '', env } as any
	return {
		nk,
		// A whole Steam login: the before-hook, then the after-hook.
		login(userId: string, ip: string) {
			steamIdForTicket = accounts[userId]
			beforeAuthenticateCustom(ctx('', ip), fakeLogger, nk as any, {
				account: { id: 'x', vars: { steam_ticket: 'ab'.repeat(16) } },
			})
			afterAuthenticateCustom(
				ctx(userId, ip),
				fakeLogger,
				nk as any,
				{},
				{} as any,
			)
		},
		refresh(userId: string, ip: string) {
			return beforeSessionRefresh(ctx(userId, ip), fakeLogger, nk as any, {
				token: 't',
			})
		},
		ban(userId: string, banId: string, expiresAt: number | null) {
			rpcAdminBanApply(
				serverCall,
				fakeLogger,
				nk as any,
				JSON.stringify({
					userId,
					type: 'account',
					banId,
					expiresAt,
					reason: 'cheating',
				}),
			)
		},
		networkBans(userId: string) {
			return JSON.parse(
				rpcAdminNetworkBans(
					serverCall,
					fakeLogger,
					nk as any,
					JSON.stringify({ userId }),
				),
			)
		},
		networks(userId: string) {
			return JSON.parse(
				rpcAdminPlayerNetworks(
					serverCall,
					fakeLogger,
					nk as any,
					JSON.stringify({ userId }),
				),
			)
		},
		lift(banId: string) {
			return JSON.parse(
				rpcAdminNetworkBanLift(
					serverCall,
					fakeLogger,
					nk as any,
					JSON.stringify({ banId }),
				),
			)
		},
		check(ip: string) {
			return JSON.parse(
				rpcAdminNetworkCheck(
					serverCall,
					fakeLogger,
					nk as any,
					JSON.stringify({ ip }),
				),
			)
		},
		purge() {
			return JSON.parse(
				rpcAdminIpHashesPurge(serverCall, fakeLogger, nk as any, '{}'),
			)
		},
	}
}

const NETWORK_BANNED =
	/Your network is banned from online play\. To appeal, email bmp@virtualized\.dev/

describe('Network bans', () => {
	it('a permanent account ban blocks a second account from the same network', () => {
		const w = world()
		w.login(A, HOME)
		w.ban(A, 'ban-1', null)
		expect(() => w.login(B, HOME)).toThrow(NETWORK_BANNED)
		expect(() => w.login(B, CAFE)).not.toThrow()
	})

	it('lists the networks an account logged in from, each with its last login', () => {
		const w = world()
		expect(w.networks(A).networks).toEqual([])
		w.login(A, HOME)
		w.login(A, CAFE)
		const { networks } = w.networks(A)
		expect(networks).toHaveLength(2)
		for (const network of networks) {
			expect(network.hash).toMatch(/^[0-9a-f]{64}$/)
			expect(network.lastSeen).toBeGreaterThan(Date.now() - 60 * 1000)
		}
		expect(w.networks(B).networks).toEqual([])
	})

	it('a timed account ban never bans a network', () => {
		const w = world()
		w.login(A, HOME)
		w.ban(A, 'ban-1', Date.now() + DAY)
		expect(() => w.login(B, HOME)).not.toThrow()
		expect(w.networkBans(A).networkBans).toEqual([])
	})

	it('bans an IPv6 /64, so another address in it is refused too', () => {
		const w = world()
		w.login(A, HOME_V6)
		w.ban(A, 'ban-1', null)
		expect(() => w.login(B, '2001:db8:1:2:ffff::99')).toThrow(NETWORK_BANNED)
		expect(() => w.login(B, '2001:db8:1:3::10')).not.toThrow()
	})

	it('also refuses a session refresh from a banned network', () => {
		const w = world()
		w.login(A, HOME)
		w.login(B, CAFE)
		w.ban(A, 'ban-1', null)
		expect(() => w.refresh(B, HOME)).toThrow(NETWORK_BANNED)
		expect(w.refresh(B, CAFE)).toEqual({ token: 't' })
	})

	it('blocks logins until an admin lifts it, and the same ban applied again does not bring it back', () => {
		const w = world()
		w.login(A, HOME)
		w.ban(A, 'ban-1', null)
		expect(w.networkBans(B).networkBans).toEqual([])
		expect(w.networkBans(A).networkBans).toEqual([
			expect.objectContaining({
				banId: 'ban-1',
				userId: A,
				networks: 1,
				liftedAt: null,
			}),
		])
		expect(w.lift('ban-1')).toEqual({ lifted: true })
		expect(() => w.login(B, HOME)).not.toThrow()
		w.ban(A, 'ban-1', null)
		expect(() => w.login(B, HOME)).not.toThrow()
		expect(w.networkBans(A).networkBans).toEqual([
			expect.objectContaining({
				banId: 'ban-1',
				networks: 0,
				liftedAt: expect.any(Number),
			}),
		])
	})

	it('shows an admin the network bans that cover a blocked player who logged in from that network before', () => {
		const w = world()
		w.login(B, HOME)
		w.login(A, HOME)
		w.ban(A, 'ban-1', null)
		expect(w.networkBans(B).networkBans).toEqual([
			expect.objectContaining({ banId: 'ban-1', userId: A }),
		])
	})

	it('bans only the networks of the last 30 days', () => {
		const w = world()
		const realNow = Date.now
		try {
			Date.now = () => realNow() - 31 * DAY
			w.login(A, CAFE)
			Date.now = realNow
			w.login(A, HOME)
			w.ban(A, 'ban-1', null)
		} finally {
			Date.now = realNow
		}
		expect(() => w.login(B, CAFE)).not.toThrow()
		expect(() => w.login(B, HOME)).toThrow(NETWORK_BANNED)
	})

	it('deletes login hashes 30 days after the last login from that network', () => {
		const w = world()
		const realNow = Date.now
		try {
			Date.now = () => realNow() - 31 * DAY
			w.login(A, CAFE)
			w.login(B, CAFE)
			Date.now = realNow
			w.login(A, HOME)
		} finally {
			Date.now = realNow
		}
		// A's old hash already went at A's next login; B never came back.
		expect(w.purge()).toEqual({ deleted: 1, more: false })
		const stored = [...w.nk.objects.keys()].filter((k) =>
			k.startsWith('ip_hashes/'),
		)
		expect(stored).toEqual([`ip_hashes/${A}/networks`])
		expect(Object.keys(w.nk.objects.get(stored[0])?.value)).toHaveLength(1)
	})

	it('stores a salted hash, never the address', () => {
		const hashesWith = (salt: string) => {
			const w = world('official', salt)
			w.login(A, HOME)
			return Object.keys(w.nk.objects.get(`ip_hashes/${A}/networks`)?.value)
		}
		const one = hashesWith('salt-one')
		expect(JSON.stringify(one)).not.toContain(HOME)
		expect(one).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)])
		expect(hashesWith('salt-two')).not.toEqual(one)
	})

	it.each(['community', 'dev'] as const)(
		'does nothing on a %s server',
		(kind) => {
			const w = world(kind)
			w.login(A, HOME)
			w.ban(A, 'ban-1', null)
			expect(() => w.login(B, HOME)).not.toThrow()
			expect(
				[...w.nk.objects.keys()].filter((k) =>
					/^(ip_hashes|network_ban)/.test(k),
				),
			).toEqual([])
		},
	)
})

describe('Network check for the website', () => {
	it('says whether an address is on a banned network, and nothing about the account', () => {
		const w = world()
		w.login(A, HOME)
		w.ban(A, 'ban-1', null)
		expect(w.check(HOME)).toEqual({ banned: true, banIds: ['ban-1'] })
		expect(w.check(CAFE)).toEqual({ banned: false, banIds: [] })
		w.lift('ban-1')
		expect(w.check(HOME)).toEqual({ banned: false, banIds: [] })
	})

	it('says not banned on a server without network bans', () => {
		const w = world('community')
		expect(w.check(HOME)).toEqual({ banned: false, banIds: [] })
	})
})
