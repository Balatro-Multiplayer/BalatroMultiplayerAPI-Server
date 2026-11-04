import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import { listBans } from '../../infrastructure/gateways/ban.gateway.js'
import { getIntegrityEventsForPlayer } from '../../infrastructure/gateways/launcher-integrity.gateway.js'
import * as pageGateway from '../../infrastructure/gateways/player-page.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { getRunsForPlayer } from '../../infrastructure/gateways/replay-log.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import {
	insertWarning,
	listWarnings,
} from '../../infrastructure/gateways/warning.gateway.js'
import { callNakamaRpc } from '../../infrastructure/nakama/admin-client.js'
import {
	networkBansInNakama,
	playerNetworksInNakama,
} from '../../infrastructure/nakama/moderation-sync.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock(
	'../../infrastructure/gateways/player-page.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		listPlayerChat: vi.fn().mockResolvedValue([]),
		listPlayerQueueItems: vi.fn().mockResolvedValue([]),
		listPlayerNotes: vi.fn().mockResolvedValue([]),
		insertPlayerNote: vi.fn().mockResolvedValue({ id: 'n1' }),
		namesOf: vi.fn().mockResolvedValue({}),
	}),
)
vi.mock(
	'../../infrastructure/gateways/replay-log.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		getRunsForPlayer: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
	}),
)
vi.mock(
	'../../infrastructure/gateways/warning.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		listWarnings: vi.fn().mockResolvedValue([]),
		insertWarning: vi.fn().mockResolvedValue({ id: 'w1' }),
	}),
)
vi.mock(
	'../../infrastructure/gateways/launcher-integrity.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		getIntegrityEventsForPlayer: vi.fn().mockResolvedValue([]),
	}),
)
vi.mock(
	'../../infrastructure/nakama/admin-client.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		callNakamaRpc: vi.fn().mockResolvedValue({ ok: true, value: {} }),
		isNakamaAdminEnabled: vi.fn().mockReturnValue(true),
	}),
)
vi.mock(
	'../../infrastructure/nakama/moderation-sync.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		networkBansInNakama: vi.fn().mockResolvedValue({ ok: true, value: [] }),
		playerNetworksInNakama: vi.fn().mockResolvedValue({ ok: true, value: [] }),
		nakamaUserIdOf: vi.fn().mockResolvedValue('nk-target'),
	}),
)

vi.mock(
	'../../infrastructure/gateways/strike.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		getLadderSteps: vi.fn().mockResolvedValue({
			chat: ['warning', '24h', '7d', '30d', 'permanent'],
			play: ['warning', '24h', '7d', '30d', 'permanent'],
		}),
		listStrikes: vi.fn().mockResolvedValue([]),
		insertStrike: vi.fn().mockResolvedValue(undefined),
	}),
)

const app = createTestApp()

beforeEach(() => {
	;(db as any).transaction = vi.fn(async (run: (tx: unknown) => unknown) =>
		run({ tx: true }),
	)
})
const TARGET = 'target-1'

const targetRow = {
	id: TARGET,
	steamName: 'Target',
	steamIdHash: 'steam-hash',
	discordIdHash: 'discord-hash',
	discordUsername: 'target#1',
	privileges: [],
	nakamaUserId: 'nk-target',
	deletedAt: null,
}

// The signed-in staff member is found by id; the target is found by its own id.
function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockImplementation((async (
		id: string,
	) =>
		id === TARGET
			? targetRow
			: id === playerId
				? { id, privileges }
				: null) as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

describe('GET /api/webadmin/players/:id/page', () => {
	it('refuses a player with no staff role', async () => {
		const res = await request(app)
			.get(`/api/webadmin/players/${TARGET}/page`)
			.set('Authorization', authAs('plain', []))
		expect(res.status).toBe(403)
	})

	it('answers 404 for an unknown player', async () => {
		const res = await request(app)
			.get('/api/webadmin/players/nobody/page')
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(res.status).toBe(404)
	})

	it('gives a moderator the history, with who gave and lifted each punishment, and no identity data', async () => {
		vi.mocked(listBans).mockResolvedValue([
			{
				id: 'b1',
				playerId: TARGET,
				banType: 'chat',
				expiresAt: null,
				issuedBy: 'moderator:mod-2',
				issuedAt: new Date('2026-10-01'),
				reason: 'spam',
				liftedAt: new Date('2026-10-02'),
				liftedBy: 'admin:adm-1',
			},
		])
		vi.mocked(pageGateway.namesOf).mockResolvedValue({
			'moderator:mod-2': 'Modder',
			'admin:adm-1': 'Boss',
		})
		vi.mocked(getRunsForPlayer).mockResolvedValue({
			runs: [
				{
					id: 'run-1',
					lobbyCode: 'ABC',
					modId: 'pvp',
					lobbyType: 'public',
					status: 'completed',
					startedAt: new Date(),
					finalizedAt: null,
				},
			],
			total: 1,
		})
		vi.mocked(pageGateway.listPlayerChat).mockResolvedValue([
			{ id: 1, message: 'hi', flagged: false } as any,
		])
		vi.mocked(pageGateway.listPlayerQueueItems).mockResolvedValue([
			{ id: 7, itemType: 'report' } as any,
		])
		vi.mocked(pageGateway.listPlayerNotes).mockResolvedValue([
			{ id: 'n1', note: 'watch' } as any,
		])
		vi.mocked(listWarnings).mockResolvedValue([
			{ id: 'w1', message: 'be nice' } as any,
		])
		vi.mocked(getIntegrityEventsForPlayer).mockResolvedValue([
			{ id: 3, kind: 'login', reason: 'timeout' } as any,
		])

		const res = await request(app)
			.get(`/api/webadmin/players/${TARGET}/page`)
			.set('Authorization', authAs('mod-1', ['moderator']))

		expect(res.status).toBe(200)
		expect(res.body.player).toMatchObject({ id: TARGET, steamName: 'Target' })
		expect(res.body.player).not.toHaveProperty('steamIdHash')
		expect(res.body.player).not.toHaveProperty('discordIdHash')
		expect(res.body.player).not.toHaveProperty('discordUsername')
		expect(res.body.punishments.bans[0]).toMatchObject({
			issuedByName: 'Modder',
			liftedByName: 'Boss',
		})
		expect(res.body.punishments.warnings).toHaveLength(1)
		expect(res.body.matches).toEqual([expect.objectContaining({ id: 'run-1' })])
		expect(res.body.chat).toHaveLength(1)
		expect(res.body.queueItems).toHaveLength(1)
		expect(res.body.notes).toHaveLength(1)
		expect(res.body.integrityEvents).toHaveLength(1)
		expect(JSON.stringify(res.body)).not.toContain('steam-hash')
		expect(vi.mocked(playerNetworksInNakama)).not.toHaveBeenCalled()
	})
})

describe('GET /api/webadmin/players/:id/identity', () => {
	it('gives a moderator nothing and reads no identity data', async () => {
		const res = await request(app)
			.get(`/api/webadmin/players/${TARGET}/identity`)
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(res.status).toBe(403)
		expect(vi.mocked(playerNetworksInNakama)).not.toHaveBeenCalled()
		expect(vi.mocked(networkBansInNakama)).not.toHaveBeenCalled()
	})

	it('gives an admin the Steam and Discord ids, the networks, the network bans and the linked accounts', async () => {
		vi.mocked(playerNetworksInNakama).mockResolvedValue({
			ok: true,
			value: [
				{ hash: 'h1', lastSeen: 100 },
				{ hash: 'h2', lastSeen: 200 },
			],
		})
		vi.mocked(networkBansInNakama).mockResolvedValue({
			ok: true,
			value: [
				{
					banId: 'nb1',
					own: false,
					bannedUserId: 'nk-other',
					networks: 2,
					bannedAt: 1,
					liftedAt: null,
				},
				{
					banId: 'nb2',
					own: true,
					bannedUserId: 'nk-target',
					networks: 1,
					bannedAt: 2,
					liftedAt: null,
				},
			],
		})
		vi.mocked(playerGateway.findPlayerIdsByNakamaUserIds).mockResolvedValue(
			new Map([['nk-other', 'other-1']]),
		)
		const base = authAs('adm-1', ['admin'])
		vi.mocked(playerGateway.findPlayerById).mockImplementation((async (
			id: string,
		) =>
			id === TARGET
				? targetRow
				: id === 'other-1'
					? { id, steamName: 'Other' }
					: { id, privileges: ['admin'] }) as any)

		const res = await request(app)
			.get(`/api/webadmin/players/${TARGET}/identity`)
			.set('Authorization', base)

		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({
			steamIdHash: 'steam-hash',
			discordIdHash: 'discord-hash',
			discordUsername: 'target#1',
			networks: {
				count: 2,
				hashes: [
					{ hash: 'h1', lastSeen: 100 },
					{ hash: 'h2', lastSeen: 200 },
				],
			},
			linkedAccounts: [{ playerId: 'other-1', name: 'Other' }],
		})
		expect(res.body.networkBans).toHaveLength(2)
	})
})

describe('POST /api/webadmin/players/:id/notes', () => {
	it('needs a note', async () => {
		const res = await request(app)
			.post(`/api/webadmin/players/${TARGET}/notes`)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ note: '  ' })
		expect(res.status).toBe(400)
		expect(vi.mocked(pageGateway.insertPlayerNote)).not.toHaveBeenCalled()
	})

	it('saves the note and writes a staff log entry', async () => {
		const res = await request(app)
			.post(`/api/webadmin/players/${TARGET}/notes`)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ note: 'Seen cheating in DMs' })
		expect(res.status).toBe(201)
		expect(vi.mocked(pageGateway.insertPlayerNote)).toHaveBeenCalledWith(
			{ tx: true },
			{ playerId: TARGET, note: 'Seen cheating in DMs', authorId: 'mod-1' },
		)
		expect(vi.mocked(recordStaffAction)).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				staff: { playerId: 'mod-1', role: 'moderator' },
				action: 'note',
				targetPlayerId: TARGET,
				reason: 'Seen cheating in DMs',
			}),
		)
	})
})

describe('POST /api/webadmin/players/:id/warnings', () => {
	it('needs a message and a reason', async () => {
		const token = authAs('mod-1', ['moderator'])
		expect(
			(
				await request(app)
					.post(`/api/webadmin/players/${TARGET}/warnings`)
					.set('Authorization', token)
					.send({ message: 'Stop' })
			).status,
		).toBe(400)
		expect(
			(
				await request(app)
					.post(`/api/webadmin/players/${TARGET}/warnings`)
					.set('Authorization', token)
					.send({ reason: 'spam' })
			).status,
		).toBe(400)
		expect(vi.mocked(insertWarning)).not.toHaveBeenCalled()
	})

	it('saves the warning, logs it and tells the player', async () => {
		const res = await request(app)
			.post(`/api/webadmin/players/${TARGET}/warnings`)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ message: 'Stop spamming', reason: 'Third spam report' })
		expect(res.status).toBe(201)
		expect(vi.mocked(insertWarning)).toHaveBeenCalledWith(
			{ tx: true },
			{
				playerId: TARGET,
				itemId: null,
				message: 'Stop spamming',
				issuedBy: 'moderator:mod-1',
			},
		)
		expect(vi.mocked(recordStaffAction)).toHaveBeenCalledWith(
			{ tx: true },
			expect.objectContaining({
				action: 'warn',
				targetPlayerId: TARGET,
				reason: 'Third spam report',
			}),
		)
		expect(vi.mocked(callNakamaRpc)).toHaveBeenCalledWith(
			'admin_notify',
			expect.objectContaining({ userId: 'nk-target', code: 109 }),
		)
	})
})
