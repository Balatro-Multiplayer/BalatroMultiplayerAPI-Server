// The appeal service over an in-memory world: a transaction is a snapshot that
// a thrown error restores.
import { describe, expect, it, vi } from 'vitest'
import {
	type AppealDeps,
	type AppealRow,
	type PunishmentRef,
	createAppealService,
} from '../../features/appeals/appeals.service.js'
import type { QueueItem } from '../../features/service-queue/dispatcher.js'
import type { StaffActionEntry } from '../../shared/staff-log/actions.js'

const NOW = new Date('2026-11-04T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const PLAYER = 'player-1'
const BAN_ID = '00000000-0000-4000-8000-0000000000b1'
const WARN_ID = '00000000-0000-4000-8000-0000000000a1'
const MOD = { playerId: 'mod', role: 'moderator' as const }
const OTHER_MOD = { playerId: 'mod2', role: 'moderator' as const }
const ADMIN = { playerId: 'adm', role: 'admin' as const }

interface World {
	appeals: AppealRow[]
	items: Map<number, QueueItem>
	punishments: Map<string, PunishmentRef>
	staffLog: StaffActionEntry[]
	events: { itemId: number; action: string | null; actor: string }[]
}

function ban(over: Partial<PunishmentRef> = {}): PunishmentRef {
	return {
		id: BAN_ID,
		playerId: PLAYER,
		kind: 'ban',
		banType: 'queue',
		issuedBy: 'admin:adm',
		expiresAt: null,
		liftedAt: null,
		...over,
	}
}

function setup(punishments: PunishmentRef[] = [ban()], over: Partial<AppealDeps<World>> = {}) {
	const world: World = {
		appeals: [],
		items: new Map(),
		punishments: new Map(punishments.map((p) => [p.id, p])),
		staffLog: [],
		events: [],
	}
	let nextId = 1
	const external = {
		banInNakama: vi.fn(async () => true),
		liftBanInNakama: vi.fn(async () => true),
		liftNetworkBans: vi.fn(async () => ({ ok: true as const })),
	}
	const deps: AppealDeps<World> = {
		now: () => NOW,
		findPunishment: async (playerId, id) => {
			const p = world.punishments.get(id)
			return p && p.playerId === playerId ? { ...p } : null
		},
		punishmentById: async (id) => (world.punishments.has(id) ? { ...world.punishments.get(id)! } : null),
		historyFor: async (playerId, punishmentId) =>
			world.appeals.filter((a) => a.playerId === playerId && a.punishmentId === punishmentId).map((a) => ({ ...a })),
		insertAppeal: async (data) => {
			const row: AppealRow = {
				id: `appeal-${nextId++}`,
				status: 'open',
				decisionReason: null,
				outcome: null,
				decidedBy: null,
				decidedAt: null,
				createdAt: NOW,
				...data,
			}
			world.appeals.push(row)
			return { ...row }
		},
		enqueue: async (appeal, summary) => {
			const id = world.items.size + 1
			world.items.set(id, {
				id,
				itemType: 'appeal',
				sourceId: appeal.id,
				subjectPlayerId: appeal.playerId,
				status: 'open',
				claimedBy: null,
				claimedUntil: null,
			})
			void summary
		},
		getItem: async (id) => (world.items.has(id) ? { ...world.items.get(id)! } : null),
		getAppeal: async (id) => {
			const row = world.appeals.find((a) => a.id === id)
			return row ? { ...row } : null
		},
		...external,
		async transaction(fn) {
			const before = structuredClone({
				appeals: world.appeals,
				items: [...world.items],
				punishments: [...world.punishments],
				staffLog: world.staffLog,
				events: world.events,
			})
			try {
				return await fn(world)
			} catch (err) {
				world.appeals = before.appeals
				world.items = new Map(before.items)
				world.punishments = new Map(before.punishments)
				world.staffLog = before.staffLog
				world.events = before.events
				throw err
			}
		},
		async markResolved(tx, id) {
			const row = tx.items.get(id)
			if (!row || row.status !== 'open') return false
			tx.items.set(id, { ...row, status: 'resolved' })
			return true
		},
		async settleAppeal(tx, id, decision) {
			const row = tx.appeals.find((a) => a.id === id && a.status === 'open')
			if (!row) return false
			Object.assign(row, decision)
			return true
		},
		async liftPunishment(tx, p, liftedBy) {
			const row = tx.punishments.get(p.id)
			if (!row || row.liftedAt) return null
			row.liftedAt = NOW
			void liftedBy
			return { ...row }
		},
		async shortenBan(tx, p, expiresAt) {
			const row = tx.punishments.get(p.id)
			if (!row || row.liftedAt) return null
			row.expiresAt = expiresAt
			return { ...row }
		},
		recordEvent: async (tx, e) => {
			tx.events.push({ itemId: e.itemId, action: e.action, actor: e.actor })
		},
		recordStaffAction: async (tx, entry) => {
			tx.staffLog.push(entry)
		},
		...over,
	}
	return { world, external, service: createAppealService(deps) }
}

const submit = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) =>
	s.service.submit({ playerId: PLAYER, punishmentId: BAN_ID, message: 'I did not do it', networkBanIds: [], ...over } as never)

describe('submitting an appeal', () => {
	it('stores the appeal and puts one item in the queue', async () => {
		const s = setup()
		const result = await submit(s)
		expect(result).toMatchObject({ ok: true })
		expect(s.world.appeals).toHaveLength(1)
		expect(s.world.appeals[0]).toMatchObject({ playerId: PLAYER, punishmentId: BAN_ID, status: 'open', message: 'I did not do it' })
		expect([...s.world.items.values()]).toMatchObject([{ itemType: 'appeal', subjectPlayerId: PLAYER }])
	})

	it('refuses a blank message', async () => {
		const s = setup()
		expect(await submit(s, { message: '   ' })).toMatchObject({ ok: false, refusal: { code: 'invalid_message' } })
		expect(s.world.appeals).toEqual([])
	})

	it("refuses a punishment that is not the player's", async () => {
		const s = setup([ban({ playerId: 'someone-else' })])
		expect(await submit(s)).toMatchObject({ ok: false, refusal: { code: 'not_found' } })
	})

	it('refuses a punishment already lifted', async () => {
		const s = setup([ban({ liftedAt: new Date(NOW.getTime() - DAY) })])
		expect(await submit(s)).toMatchObject({ ok: false, refusal: { code: 'already_lifted' } })
	})

	it('refuses a second appeal while one is open', async () => {
		const s = setup()
		await submit(s)
		expect(await submit(s)).toMatchObject({ ok: false, refusal: { code: 'open' } })
		expect(s.world.appeals).toHaveLength(1)
	})

	it('refuses for 30 days after a denial, then allows it', async () => {
		const s = setup()
		await submit(s)
		await s.service.decide(1, MOD, { decision: 'deny', reason: 'no' })
		expect(await submit(s)).toMatchObject({ ok: false, refusal: { code: 'cooling_down' } })
		s.world.appeals[0]!.decidedAt = new Date(NOW.getTime() - 31 * DAY)
		expect(await submit(s)).toMatchObject({ ok: true })
	})

	it('appeals a network ban only when one blocks the player, and keeps its id', async () => {
		const s = setup([])
		expect(await submit(s, { punishmentId: null })).toMatchObject({ ok: false, refusal: { code: 'not_blocked' } })
		expect(await submit(s, { punishmentId: null, networkBanIds: ['nb-1'] })).toMatchObject({ ok: true })
		expect(s.world.appeals[0]).toMatchObject({ targetKind: 'network_ban', punishmentId: null, networkBanIds: ['nb-1'] })
	})
})

describe('deciding an appeal', () => {
	async function opened(punishments?: PunishmentRef[]) {
		const s = setup(punishments)
		await submit(s)
		return s
	}

	it('lets a moderator deny: the item closes, the player sees the reason, the staff log has one entry', async () => {
		const s = await opened()
		const result = await s.service.decide(1, MOD, { decision: 'deny', reason: 'The evidence is clear' })
		expect(result).toMatchObject({ ok: true })
		expect(s.world.appeals[0]).toMatchObject({ status: 'denied', decisionReason: 'The evidence is clear', decidedBy: 'moderator:mod' })
		expect(s.world.items.get(1)!.status).toBe('resolved')
		expect(s.world.staffLog).toMatchObject([
			{ action: 'appeal_deny', reason: 'The evidence is clear', targetPlayerId: PLAYER, itemId: 1, staff: { playerId: 'mod', role: 'moderator' } },
		])
		expect(s.world.punishments.get(BAN_ID)!.liftedAt).toBeNull()
	})

	it('requires a reason', async () => {
		const s = await opened()
		expect(await s.service.decide(1, MOD, { decision: 'deny', reason: ' ' })).toMatchObject({
			ok: false,
			refusal: { code: 'invalid_body', field: 'reason' },
		})
		expect(s.world.appeals[0]!.status).toBe('open')
	})

	it('refuses a moderator on an appeal of their own punishment, and both decisions', async () => {
		const s = await opened([ban({ issuedBy: 'moderator:mod' })])
		expect(await s.service.decide(1, MOD, { decision: 'deny', reason: 'x' })).toEqual({ ok: false, refusal: { code: 'forbidden' } })
		expect(await s.service.decide(1, ADMIN, { decision: 'deny', reason: 'x' })).toMatchObject({ ok: true })
	})

	it('refuses a moderator a grant, and changes nothing', async () => {
		const s = await opened()
		expect(await s.service.decide(1, OTHER_MOD, { decision: 'grant', outcome: 'lift', reason: 'x' })).toEqual({
			ok: false,
			refusal: { code: 'forbidden' },
		})
		expect(s.world.appeals[0]!.status).toBe('open')
		expect(s.world.punishments.get(BAN_ID)!.liftedAt).toBeNull()
		expect(s.world.staffLog).toEqual([])
	})

	it('lets an admin grant by lifting the ban, in the game too, with one staff log entry', async () => {
		const s = await opened()
		const result = await s.service.decide(1, ADMIN, { decision: 'grant', outcome: 'lift', reason: 'First offence' })
		expect(result).toMatchObject({ ok: true })
		expect(s.world.appeals[0]).toMatchObject({ status: 'granted', outcome: 'lifted', decisionReason: 'First offence' })
		expect(s.world.punishments.get(BAN_ID)!.liftedAt).toEqual(NOW)
		expect(s.external.liftBanInNakama).toHaveBeenCalledWith(PLAYER, BAN_ID)
		expect(s.world.staffLog).toMatchObject([{ action: 'appeal_grant', detail: { outcome: 'lifted', punishmentId: BAN_ID } }])
	})

	it('lets an admin grant by shortening, and tells the game the new end', async () => {
		const s = await opened()
		await s.service.decide(1, ADMIN, { decision: 'grant', outcome: 'shorten', duration: '7d', reason: 'Too long' })
		const end = new Date(NOW.getTime() + 7 * DAY)
		expect(s.world.punishments.get(BAN_ID)).toMatchObject({ expiresAt: end, liftedAt: null })
		expect(s.world.appeals[0]).toMatchObject({ status: 'granted', outcome: 'shortened' })
		expect(s.external.banInNakama).toHaveBeenCalledWith(expect.objectContaining({ id: BAN_ID, expiresAt: end }))
	})

	it('refuses a shortening that is not shorter, and a shortening of a warning', async () => {
		const s = await opened([ban({ expiresAt: new Date(NOW.getTime() + 2 * DAY) })])
		expect(await s.service.decide(1, ADMIN, { decision: 'grant', outcome: 'shorten', duration: '7d', reason: 'x' })).toMatchObject({
			ok: false,
			refusal: { code: 'invalid_body', field: 'duration' },
		})
		const w = setup([{ ...ban(), id: WARN_ID, kind: 'warning', banType: null }])
		await w.service.submit({ playerId: PLAYER, punishmentId: WARN_ID, message: 'm', networkBanIds: [] })
		expect(await w.service.decide(1, ADMIN, { decision: 'grant', outcome: 'shorten', duration: '24h', reason: 'x' })).toMatchObject({
			ok: false,
			refusal: { code: 'invalid_body', field: 'outcome' },
		})
	})

	it('lifts a warning without calling the game', async () => {
		const s = setup([{ ...ban(), id: WARN_ID, kind: 'warning', banType: null }])
		await s.service.submit({ playerId: PLAYER, punishmentId: WARN_ID, message: 'm', networkBanIds: [] })
		await s.service.decide(1, ADMIN, { decision: 'grant', outcome: 'lift', reason: 'ok' })
		expect(s.world.punishments.get(WARN_ID)!.liftedAt).toEqual(NOW)
		expect(s.external.liftBanInNakama).not.toHaveBeenCalled()
	})

	it('lifts the network bans of a network ban appeal, and only an admin may', async () => {
		const s = setup([])
		await submit(s, { punishmentId: null, networkBanIds: ['nb-1', 'nb-2'] })
		expect(await s.service.decide(1, MOD, { decision: 'grant', outcome: 'lift', reason: 'x' })).toMatchObject({ ok: false })
		const result = await s.service.decide(1, ADMIN, { decision: 'grant', outcome: 'lift', reason: 'Shared address' })
		expect(result).toMatchObject({ ok: true })
		expect(s.external.liftNetworkBans).toHaveBeenCalledWith(['nb-1', 'nb-2'])
		expect(s.world.appeals[0]).toMatchObject({ status: 'granted', outcome: 'lifted' })
	})

	it('changes nothing when Nakama cannot lift the network ban', async () => {
		const s = setup([], { liftNetworkBans: vi.fn(async () => ({ ok: false as const })) })
		await submit(s, { punishmentId: null, networkBanIds: ['nb-1'] })
		const result = await s.service.decide(1, ADMIN, { decision: 'grant', outcome: 'lift', reason: 'x' })
		expect(result).toMatchObject({ ok: false, refusal: { code: 'nakama_failed' } })
		expect(s.world.appeals[0]!.status).toBe('open')
		expect(s.world.items.get(1)!.status).toBe('open')
	})

	it('refuses a decision on an item that is not an open appeal', async () => {
		const s = await opened()
		expect(await s.service.decide(9, ADMIN, { decision: 'deny', reason: 'x' })).toEqual({ ok: false, refusal: { code: 'not_found' } })
		await s.service.decide(1, ADMIN, { decision: 'deny', reason: 'x' })
		expect(await s.service.decide(1, ADMIN, { decision: 'deny', reason: 'y' })).toMatchObject({ ok: false, refusal: { code: 'wrong_status' } })
	})

	it("refuses another staff member's live claim", async () => {
		const s = await opened()
		const until = new Date(NOW.getTime() + 60_000)
		s.world.items.set(1, { ...s.world.items.get(1)!, claimedBy: 'moderator:mod2', claimedUntil: until })
		expect(await s.service.decide(1, MOD, { decision: 'deny', reason: 'x' })).toMatchObject({ ok: false, refusal: { code: 'claimed' } })
	})
})
