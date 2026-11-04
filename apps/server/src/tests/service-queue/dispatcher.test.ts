// The dispatcher over an in-memory queue: a transaction is a snapshot that
// a thrown error restores, so a rollback leaves nothing behind.
import { describe, expect, it, vi } from 'vitest'
import type { StaffActionEntry } from '../../shared/staff-log/actions.js'
import { DEFAULT_LADDER_STEPS } from '../../features/strikes/ladder.js'
import {
	type BanRow,
	type DispatcherDeps,
	type GameRef,
	type QueueItem,
	createDispatcher,
} from '../../features/service-queue/dispatcher.js'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const MOD = { playerId: 'mod', role: 'moderator' as const }
const ADMIN = { playerId: 'adm', role: 'admin' as const }
const BAN_ID = '00000000-0000-4000-8000-0000000000b1'

interface World {
	items: Map<number, QueueItem & { resolutionAction?: string | null }>
	sourceStatus: Map<number, string>
	events: { itemId: number; kind: string; action: string | null; actor: string; detail: unknown }[]
	bans: BanRow[]
	warnings: { playerId: string; message: string }[]
	staffLog: StaffActionEntry[]
	labels: { itemId: number; label: string }[]
	strikes: StrikeRow[]
}

type StrikeRow = Parameters<DispatcherDeps<World>['insertStrike']>[1]

function item(over: Partial<QueueItem> = {}): QueueItem {
	return {
		id: 1,
		itemType: 'report',
		sourceId: '10',
		subjectPlayerId: 'bad',
		status: 'open',
		claimedBy: null,
		claimedUntil: null,
		...over,
	}
}

function setup(seed: QueueItem, over: Partial<DispatcherDeps<World>> = {}) {
	const world: World = {
		items: new Map([[seed.id, { ...seed }]]),
		sourceStatus: new Map([[seed.id, 'open']]),
		events: [],
		bans: [],
		warnings: [],
		staffLog: [],
		labels: [],
		strikes: [],
	}
	const snapshot = () => structuredClone({ ...world, items: [...world.items], sourceStatus: [...world.sourceStatus] })
	const external = {
		banInNakama: vi.fn(async () => true),
		liftBanInNakama: vi.fn(async () => true),
		notifyWarned: vi.fn(async () => true),
		rescore: vi.fn(async () => {}),
		voidGame: vi.fn(async () => ({ kind: 'voided' as const, rerated: true })),
		overturnGame: vi.fn(async () => ({ kind: 'applied' as const, rerated: true })),
	}
	const deps: DispatcherDeps<World> = {
		now: () => NOW,
		getItem: async (id) => (world.items.has(id) ? { ...world.items.get(id)! } : null),
		sourcesOf: async (it) =>
			it.itemType === 'report'
				? { subjectPlayerId: it.subjectPlayerId, report: { reporterId: 'rep', reportedId: 'bad' } }
				: it.itemType === 'match_conflict'
					? { subjectPlayerId: it.subjectPlayerId, conflict: { firstReporterId: 'a', conflictingReporterId: 'b' } }
					: it.itemType === 'contest'
						? { subjectPlayerId: it.subjectPlayerId, contest: { contesterId: 'a', againstId: 'b' } }
					: { subjectPlayerId: it.subjectPlayerId },
		playerExists: async (id) => id !== 'ghost',
		getBan: async (id) => world.bans.find((b) => b.id === id) ?? null,
		gameOf: async (): Promise<GameRef> => ({ runId: 'run-1', matchmade: true, ranked: true }),
		conflictOf: async () => ({
			firstReporterId: 'a',
			firstPlacements: [
				{ playerId: 'a', place: 1 },
				{ playerId: 'b', place: 2 },
			],
			conflictingReporterId: 'b',
			conflictingPlacements: [
				{ playerId: 'a', place: 2 },
				{ playerId: 'b', place: 1 },
			],
		}),
		flaggedPlayersOf: async () => new Set(['a']),
		participantsOf: async () => ['a', 'b'],
		originalResultOf: async () => [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 2 },
		],
		...external,
		async transaction(fn) {
			const before = snapshot()
			try {
				return await fn(world)
			} catch (err) {
				world.items = new Map(before.items)
				world.sourceStatus = new Map(before.sourceStatus)
				world.events = before.events
				world.bans = before.bans
				world.warnings = before.warnings
				world.staffLog = before.staffLog
				world.labels = before.labels
				world.strikes = before.strikes
				throw err
			}
		},
		async markResolved(tx, id, actor, action) {
			const row = tx.items.get(id)
			if (!row || row.status !== 'open') return false
			tx.items.set(id, { ...row, status: 'resolved', claimedBy: null, claimedUntil: null, resolutionAction: action })
			return true
		},
		async markReopened(tx, id) {
			const row = tx.items.get(id)
			if (!row || row.status !== 'resolved') return false
			tx.items.set(id, { ...row, status: 'open', resolutionAction: null })
			return true
		},
		touch: async () => {},
		async setSourceStatus(tx, it, status) {
			if (!tx.sourceStatus.has(it.id)) return false
			tx.sourceStatus.set(it.id, status)
			return true
		},
		async recordEvent(tx, e) {
			tx.events.push({ itemId: e.itemId, kind: e.kind, action: e.action, actor: e.actor, detail: e.detail })
		},
		async insertBan(tx, ban) {
			const row: BanRow = { id: BAN_ID, issuedAt: NOW, liftedAt: null, liftedBy: null, ...ban }
			tx.bans.push(row)
			return row
		},
		async liftBan(tx, playerId, banId, liftedBy) {
			const ban = tx.bans.find((b) => b.id === banId && b.playerId === playerId && !b.liftedAt)
			if (!ban) return null
			ban.liftedAt = NOW
			ban.liftedBy = liftedBy
			return { ...ban }
		},
		async recordStaffAction(tx, entry) {
			tx.staffLog.push(entry)
		},
		async saveChatLabels(tx, it, label) {
			tx.labels.push({ itemId: it.id, label })
		},
		// A player with 2 counting strikes: the recommended step is 7d.
		ladderStateOf: async (_playerId, ladder) => ({
			steps: DEFAULT_LADDER_STEPS[ladder],
			strikes: [{ issuedAt: NOW, liftedAt: null }, { issuedAt: NOW, liftedAt: null }],
		}),
		async insertStrike(tx, strike) {
			tx.strikes.push(strike)
		},
		async insertWarning(tx, w) {
			tx.warnings.push({ playerId: w.playerId, message: w.message })
			return { id: 'w1' }
		},
		...over,
	}
	const strict = createDispatcher(deps)
	// Most tests are not about the reason, so this one supplies it; `strict` does not.
	const dispatcher = {
		run: (id: number, action: string, staff: typeof MOD, body: Record<string, unknown>) =>
			strict.run(id, action, staff, { reason: 'because', deviationReason: 'test', ...body }),
	}
	return { world, external, dispatcher, strict }
}

describe('the dispatcher', () => {
	it('resolves the queue row and the source together, with an audit event', async () => {
		const { world, dispatcher, external } = setup(item())
		const result = await dispatcher.run(1, 'resolve', MOD, { note: 'handled' })
		expect(result).toMatchObject({ ok: true, value: { action: 'resolve', item: { status: 'resolved' } } })
		expect(world.sourceStatus.get(1)).toBe('resolved')
		expect(world.events).toEqual([{ itemId: 1, kind: 'acted', action: 'resolve', actor: 'moderator:mod', detail: null }])
		expect(external.rescore).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), ['bad'])
	})

	it('refuses unknown items, unknown actions and bad bodies', async () => {
		const { dispatcher } = setup(item())
		expect(await dispatcher.run(9, 'resolve', MOD, {})).toEqual({ ok: false, refusal: { code: 'not_found' } })
		expect(await dispatcher.run(1, 'smite', MOD, {})).toEqual({ ok: false, refusal: { code: 'unknown_action' } })
		expect(await dispatcher.run(1, 'warn', MOD, {})).toMatchObject({ ok: false, refusal: { code: 'invalid_body', field: 'message' } })
	})

	it("refuses a moderator an admin's action (403), and an action the type does not take", async () => {
		const { dispatcher, world } = setup(item())
		expect(
			await dispatcher.run(1, 'account_ban', MOD, { duration: '7d' }),
		).toEqual({ ok: false, refusal: { code: 'forbidden' } })
		expect(await dispatcher.run(1, 'unban', MOD, { banId: BAN_ID })).toEqual({
			ok: false,
			refusal: { code: 'forbidden' },
		})
		expect(await dispatcher.run(1, 'void', ADMIN, {})).toEqual({
			ok: false,
			refusal: { code: 'not_for_type' },
		})
		expect(world.events).toEqual([])
	})

	it("blocks every action but a note while another moderator's claim is live", async () => {
		const until = new Date(NOW.getTime() + 60_000)
		const { dispatcher, world } = setup(item({ claimedBy: 'moderator:other', claimedUntil: until }))
		expect(await dispatcher.run(1, 'resolve', MOD, {})).toEqual({
			ok: false,
			refusal: { code: 'claimed', claimedBy: 'moderator:other', claimedUntil: until },
		})
		expect((await dispatcher.run(1, 'note', MOD, { note: 'looking too' })).ok).toBe(true)
		expect(world.events.map((e) => e.kind)).toEqual(['noted'])
		// The holder itself, and anyone once it expires.
		expect((await setup(item({ claimedBy: 'moderator:mod', claimedUntil: until })).dispatcher.run(1, 'resolve', MOD, {})).ok).toBe(true)
		expect((await setup(item({ claimedBy: 'moderator:other', claimedUntil: NOW })).dispatcher.run(1, 'resolve', MOD, {})).ok).toBe(true)
	})

	it('rolls the whole transaction back when the source row is gone', async () => {
		const { dispatcher, world, external } = setup(item())
		world.sourceStatus.clear()
		expect(await dispatcher.run(1, 'queue_ban', MOD, { duration: '7d', reason: 'x' })).toEqual({
			ok: false,
			refusal: { code: 'source_missing' },
		})
		expect(world.items.get(1)?.status).toBe('open')
		expect(world.bans).toEqual([])
		expect(world.events).toEqual([])
		expect(external.banInNakama).not.toHaveBeenCalled()
	})

	it('refuses a second close of the same item (the race loser)', async () => {
		const { dispatcher } = setup(item())
		await dispatcher.run(1, 'dismiss', MOD, {})
		expect(await dispatcher.run(1, 'dismiss', MOD, {})).toEqual({ ok: false, refusal: { code: 'wrong_status', status: 'resolved' } })
	})

	it('warns the subject, persists it and sends the 109 notification', async () => {
		const { dispatcher, world, external } = setup(item())
		const result = await dispatcher.run(1, 'warn', MOD, { message: 'Keep it civil' })
		expect(result).toMatchObject({ ok: true, value: { effects: { warningId: 'w1', delivered: true } } })
		expect(world.warnings).toEqual([{ playerId: 'bad', message: 'Keep it civil' }])
		expect(external.notifyWarned).toHaveBeenCalledWith('bad', {
			message: 'Keep it civil',
			itemType: 'report',
			warnedAt: NOW.getTime(),
		})
	})

	it('can sanction the reporter of a false report, but no stranger', async () => {
		const { dispatcher, world } = setup(item())
		expect(await dispatcher.run(1, 'warn', MOD, { message: 'x', targetPlayerId: 'stranger' })).toEqual({
			ok: false,
			refusal: { code: 'invalid_target' },
		})
		const result = await dispatcher.run(1, 'chat_mute', MOD, { duration: '24h', targetPlayerId: 'rep', reason: 'false report' })
		expect(result.ok).toBe(true)
		expect(world.bans[0]).toMatchObject({
			playerId: 'rep',
			banType: 'chat',
			expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
			issuedBy: 'moderator:mod',
		})
	})

	it('bans in Nakama after the commit, and reports a failed delivery without undoing it', async () => {
		const { dispatcher, world, external } = setup(item({ itemType: 'anti_cheat', sourceId: 'run-1:bad' }))
		external.banInNakama.mockResolvedValueOnce(false)
		const result = await dispatcher.run(1, 'account_ban', ADMIN, { duration: 'permanent', reason: 'cheating' })
		expect(result).toMatchObject({ ok: true, value: { effects: { delivered: false, ban: { expiresAt: null } } } })
		expect(world.bans).toHaveLength(1)
		expect(world.items.get(1)?.status).toBe('resolved')
	})

	it("acts on the one flagged player an anti-cheat item is about", async () => {
		const { dispatcher, world } = setup(item({ itemType: 'anti_cheat', sourceId: 'run-1:p2', subjectPlayerId: 'p2' }))
		expect(await dispatcher.run(1, 'queue_ban', MOD, { duration: '7d', targetPlayerId: 'p1' })).toEqual({
			ok: false,
			refusal: { code: 'invalid_target' },
		})
		expect((await dispatcher.run(1, 'queue_ban', MOD, { duration: '7d' })).ok).toBe(true)
		expect(world.bans.map((b) => b.playerId)).toEqual(['p2'])
	})

	it('refuses a sanction against a player that no longer exists', async () => {
		const { dispatcher } = setup(item({ itemType: 'integrity', sourceId: 'ghost:2026-10-21', subjectPlayerId: 'ghost' }))
		expect(await dispatcher.run(1, 'warn', MOD, { message: 'x' })).toEqual({ ok: false, refusal: { code: 'invalid_target' } })
	})

	it('reopens a resolved item and its source', async () => {
		const { dispatcher, world } = setup(item())
		await dispatcher.run(1, 'resolve', MOD, {})
		const result = await dispatcher.run(1, 'reopen', MOD, {})
		expect(result).toMatchObject({ ok: true, value: { item: { status: 'open' } } })
		expect(world.sourceStatus.get(1)).toBe('open')
		expect(world.events.map((e) => e.kind)).toEqual(['acted', 'reopened'])
	})

	it("lifts a ban the item's players hold, for admins only", async () => {
		const { dispatcher, world, external } = setup(item())
		await dispatcher.run(1, 'account_ban', ADMIN, { duration: '7d' })
		expect(await dispatcher.run(1, 'unban', MOD, { banId: BAN_ID })).toEqual({ ok: false, refusal: { code: 'forbidden' } })
		const lifted = await dispatcher.run(1, 'unban', ADMIN, { banId: BAN_ID })
		expect(lifted).toMatchObject({ ok: true, value: { effects: { liftedBan: { liftedBy: 'admin:adm' }, delivered: true } } })
		expect(external.liftBanInNakama).toHaveBeenCalledWith('bad', BAN_ID)
		expect(await dispatcher.run(1, 'unban', ADMIN, { banId: BAN_ID })).toEqual({ ok: false, refusal: { code: 'ban_not_found' } })
		expect(world.bans[0].liftedAt).toEqual(NOW)
	})

	it('voids a matchmade game (re-rating it) before closing the item', async () => {
		const { dispatcher, world, external } = setup(item({ itemType: 'forfeit_reconciliation', sourceId: '5' }))
		const result = await dispatcher.run(1, 'void', ADMIN, {})
		expect(result).toMatchObject({ ok: true, value: { effects: { voided: { runId: 'run-1', rerated: true } } } })
		expect(external.voidGame).toHaveBeenCalledWith({ runId: 'run-1', matchmade: true, ranked: true })
		expect(world.sourceStatus.get(1)).toBe('voided')
	})

	it('voids a private game by closing it only, and refuses an unresolved match', async () => {
		const priv = setup(item({ itemType: 'match_conflict' }), {
			gameOf: async () => ({ runId: 'run-p', matchmade: false, ranked: false }),
		})
		expect(await priv.dispatcher.run(1, 'void', ADMIN, {})).toMatchObject({
			ok: true,
			value: { effects: { voided: { runId: 'run-p', rerated: false } } },
		})
		expect(priv.external.voidGame).not.toHaveBeenCalled()

		const pending = setup(item({ itemType: 'match_conflict' }))
		pending.external.voidGame.mockResolvedValueOnce({ kind: 'not_resolved', status: 'pending' } as never)
		expect(await pending.dispatcher.run(1, 'void', ADMIN, {})).toMatchObject({ ok: false, refusal: { code: 'not_voidable' } })
		expect(pending.world.items.get(1)?.status).toBe('open')
	})

	it('overturns to the conflicting report, rating only the unflagged players of a ranked game', async () => {
		const { dispatcher, external, world } = setup(item({ itemType: 'match_conflict', subjectPlayerId: 'b' }))
		expect(await dispatcher.run(1, 'overturn', ADMIN, { toReportOf: 'a' })).toEqual({ ok: false, refusal: { code: 'unchanged' } })
		const result = await dispatcher.run(1, 'overturn', ADMIN, { toReportOf: 'b' })
		expect(result).toMatchObject({ ok: true, value: { effects: { overturned: { runId: 'run-1', rerated: true } } } })
		expect(external.overturnGame).toHaveBeenCalledWith({ runId: 'run-1', matchmade: true, ranked: true }, [
			{ playerId: 'b', place: 1, rated: true },
			{ playerId: 'a', place: 2, rated: false },
		])
		expect(world.sourceStatus.get(1)).toBe('resolved')
	})

	it('leaves the item open when Nakama refuses the new result', async () => {
		const { dispatcher, external, world } = setup(item({ itemType: 'match_conflict' }))
		external.overturnGame.mockResolvedValueOnce({ kind: 'failed', reason: 'admin_run_set_result rejected' } as never)
		expect(await dispatcher.run(1, 'overturn', ADMIN, { toReportOf: 'b' })).toEqual({
			ok: false,
			refusal: { code: 'nakama_failed', reason: 'admin_run_set_result rejected' },
		})
		expect(world.items.get(1)?.status).toBe('open')
	})
})

describe('a contest item', () => {
	// a contested b; the run sits unrated until a moderator decides.
	const contest = () => item({ itemType: 'contest', sourceId: 'run-1', subjectPlayerId: 'b' })
	const original = [
		{ playerId: 'a', place: 1, rated: false },
		{ playerId: 'b', place: 2, rated: true },
	]

	it('rates the original result when dismissed, leaving a flagged player out', async () => {
		const { dispatcher, external, world } = setup(contest())
		const result = await dispatcher.run(1, 'dismiss', MOD, { note: 'fair match' })
		expect(result).toMatchObject({ ok: true, value: { item: { status: 'resolved' } } })
		expect(external.overturnGame).toHaveBeenCalledWith({ runId: 'run-1', matchmade: true, ranked: true }, original)
		expect(world.events.at(-1)).toMatchObject({ action: 'dismiss', detail: { settled: 'rate_original', runId: 'run-1' } })
	})

	it('dismisses a contest nobody reported a result for without rating anything', async () => {
		const { dispatcher, external, world } = setup(contest(), { originalResultOf: async () => [] })
		expect(await dispatcher.run(1, 'dismiss', MOD, {})).toMatchObject({ ok: true })
		expect(external.overturnGame).not.toHaveBeenCalled()
		expect(world.items.get(1)?.status).toBe('resolved')
	})

	it('keeps the item open when the original result cannot be rated', async () => {
		const { dispatcher, external, world } = setup(contest())
		external.overturnGame.mockResolvedValueOnce({ kind: 'failed', reason: 'down' } as never)
		expect(await dispatcher.run(1, 'dismiss', MOD, {})).toEqual({
			ok: false,
			refusal: { code: 'nakama_failed', reason: 'down' },
		})
		expect(world.items.get(1)?.status).toBe('open')
	})

	it('voids the run', async () => {
		const { dispatcher, external } = setup(contest())
		expect(await dispatcher.run(1, 'void', ADMIN, {})).toMatchObject({
			ok: true,
			value: { effects: { voided: { runId: 'run-1' } } },
		})
		expect(external.voidGame).toHaveBeenCalledOnce()
		expect(external.overturnGame).not.toHaveBeenCalled()
	})

	it('names a winner: first place for them, the other player behind', async () => {
		const { dispatcher, external, world } = setup(contest())
		const result = await dispatcher.run(1, 'overturn', ADMIN, { toReportOf: 'b' })
		expect(result).toMatchObject({ ok: true, value: { effects: { overturned: { runId: 'run-1', rerated: true } } } })
		expect(external.overturnGame).toHaveBeenCalledWith({ runId: 'run-1', matchmade: true, ranked: true }, [
			{ playerId: 'b', place: 1, rated: true },
			{ playerId: 'a', place: 2, rated: false },
		])
		expect(world.items.get(1)?.status).toBe('resolved')
	})

	it('refuses a winner who did not play', async () => {
		const { dispatcher } = setup(contest())
		expect(await dispatcher.run(1, 'overturn', ADMIN, { toReportOf: 'z' })).toEqual({
			ok: false,
			refusal: { code: 'invalid_target' },
		})
	})

	it('rates the original result when the contester is punished for a false contest', async () => {
		const { dispatcher, external, world } = setup(contest())
		const result = await dispatcher.run(1, 'chat_mute', MOD, { targetPlayerId: 'a', duration: '24h' })
		expect(result).toMatchObject({ ok: true, value: { effects: { ban: { playerId: 'a', banType: 'chat' } } } })
		expect(external.overturnGame).toHaveBeenCalledOnce()
		expect(external.voidGame).not.toHaveBeenCalled()
		expect(world.items.get(1)?.status).toBe('resolved')
	})

	it('voids the run when the contested player is punished, the contest being upheld', async () => {
		const { dispatcher, external } = setup(contest())
		const result = await dispatcher.run(1, 'queue_ban', MOD, { duration: '7d' })
		expect(result).toMatchObject({ ok: true, value: { effects: { ban: { playerId: 'b', banType: 'queue' } } } })
		expect(external.voidGame).toHaveBeenCalledOnce()
		expect(external.overturnGame).not.toHaveBeenCalled()
	})

	it('settles a warning the same way, by who is warned', async () => {
		const { dispatcher, external } = setup(contest())
		await dispatcher.run(1, 'warn', MOD, { targetPlayerId: 'a', message: 'do not contest fair games' })
		expect(external.overturnGame).toHaveBeenCalledOnce()
	})

	it('does not touch the run for a note, a claim or a reopen', async () => {
		const { dispatcher, external } = setup(contest())
		await dispatcher.run(1, 'note', MOD, { note: 'looking' })
		await dispatcher.run(1, 'dismiss', MOD, {})
		external.overturnGame.mockClear()
		await dispatcher.run(1, 'reopen', MOD, {})
		expect(external.overturnGame).not.toHaveBeenCalled()
		expect(external.voidGame).not.toHaveBeenCalled()
	})
})

describe('the staff log', () => {
	it('refuses every action but a note when the reason is missing or blank', async () => {
		const { strict, world } = setup(item())
		for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 7 }]) {
			expect(await strict.run(1, 'resolve', MOD, body)).toMatchObject({
				ok: false,
				refusal: { code: 'invalid_body', field: 'reason' },
			})
		}
		expect(await strict.run(1, 'queue_ban', MOD, { duration: '7d' })).toMatchObject({
			ok: false,
			refusal: { code: 'invalid_body', field: 'reason' },
		})
		expect(world.staffLog).toEqual([])
		expect(world.items.get(1)?.status).toBe('open')
		expect((await strict.run(1, 'note', MOD, { note: 'no reason needed' })).ok).toBe(true)
	})

	it('logs the staff member, the target, the item and the reason for a ban and a lift', async () => {
		const { dispatcher, world } = setup(item())
		await dispatcher.run(1, 'chat_mute', MOD, { duration: '24h', reason: 'spam' })
		await dispatcher.run(1, 'reopen', MOD, { reason: 'more to do' })
		await dispatcher.run(1, 'unban', ADMIN, { banId: BAN_ID, reason: 'appeal granted' })
		expect(world.staffLog).toEqual([
			expect.objectContaining({
				staff: { playerId: 'mod', role: 'moderator' },
				action: 'chat_ban',
				targetPlayerId: 'bad',
				itemId: 1,
				reason: 'spam',
			}),
			expect.objectContaining({ action: 'reopen', reason: 'more to do' }),
			expect.objectContaining({
				staff: { playerId: 'adm', role: 'admin' },
				action: 'lift_ban',
				targetPlayerId: 'bad',
				reason: 'appeal granted',
			}),
		])
	})

	it('logs one entry for each other action kind', async () => {
		const logged = async (action: string, itemType: string, body: Record<string, unknown>, staff = ADMIN) => {
			const { dispatcher, world } = setup(item({ itemType, subjectPlayerId: 'b' }))
			await dispatcher.run(1, action, staff, { reason: `why ${action}`, ...body })
			return world.staffLog.map((e) => [e.action, e.reason])
		}
		expect(await logged('dismiss', 'report', {})).toEqual([['dismiss', 'why dismiss']])
		expect(await logged('resolve', 'report', {})).toEqual([['resolve', 'why resolve']])
		expect(await logged('warn', 'report', { message: 'hi' }, MOD)).toEqual([['warn', 'why warn']])
		expect(await logged('queue_ban', 'integrity', { duration: '7d' }, MOD)).toEqual([['queue_ban', 'why queue_ban']])
		expect(await logged('account_ban', 'integrity', { duration: '30d' })).toEqual([['account_ban', 'why account_ban']])
		expect(await logged('void', 'match_conflict', {})).toEqual([['void', 'why void']])
		expect(await logged('overturn', 'match_conflict', { toReportOf: 'b' })).toEqual([['overturn', 'why overturn']])
	})

	it('writes no entry when the action is refused', async () => {
		const { dispatcher, world } = setup(item())
		await dispatcher.run(1, 'account_ban', MOD, { duration: '7d' })
		expect(world.staffLog).toEqual([])
	})
})

describe('flagged chat decisions', () => {
	const chat = () => item({ itemType: 'flagged_chat', sourceId: 'lobby:bad' })

	it.each(['not_harmful', 'harmful_no_action'])('saves the %s label with a dismiss', async (label) => {
		const { world, dispatcher } = setup(chat())
		const result = await dispatcher.run(1, 'dismiss', MOD, { dismissLabel: label })
		expect(result.ok).toBe(true)
		expect(world.labels).toEqual([{ itemId: 1, label }])
	})

	it('refuses a dismiss that names no button', async () => {
		const { world, dispatcher } = setup(chat())
		expect(await dispatcher.run(1, 'dismiss', MOD, {})).toMatchObject({ ok: false, refusal: { code: 'invalid_body', field: 'dismissLabel' } })
		expect(world.items.get(1)?.status).toBe('open')
		expect(world.labels).toEqual([])
	})

	it('saves a harmful label with a warning and with a chat ban', async () => {
		const warned = setup(chat())
		await warned.dispatcher.run(1, 'warn', MOD, { message: 'be nice' })
		expect(warned.world.labels).toEqual([{ itemId: 1, label: 'harmful' }])
		const muted = setup(chat())
		await muted.dispatcher.run(1, 'chat_mute', MOD, { duration: '24h' })
		expect(muted.world.labels).toEqual([{ itemId: 1, label: 'harmful' }])
	})

	it('saves no label for another item type', async () => {
		const { world, dispatcher } = setup(item())
		await dispatcher.run(1, 'dismiss', MOD, {})
		expect(world.labels).toEqual([])
	})

	it('keeps no label when the decision rolls back', async () => {
		const { world, dispatcher } = setup(chat(), { recordStaffAction: async () => { throw new Rollbackish() } })
		await expect(dispatcher.run(1, 'dismiss', MOD, { dismissLabel: 'not_harmful' })).rejects.toThrow()
		expect(world.labels).toEqual([])
	})

	describe('strikes', () => {
		it('records a strike with the recommendation when staff follow it', async () => {
			const { world, strict } = setup(item())
			const result = await strict.run(1, 'queue_ban', MOD, { reason: 'x', duration: '7d' })
			expect(result.ok).toBe(true)
			expect(world.strikes).toEqual([
				{
					playerId: 'bad',
					ladder: 'play',
					banId: BAN_ID,
					warningId: null,
					recommendedStep: '7d',
					appliedStep: '7d',
					deviationReason: null,
					issuedAt: NOW,
				},
			])
		})

		it('refuses a different step with no reason, and writes nothing', async () => {
			const { world, strict } = setup(item())
			expect(await strict.run(1, 'queue_ban', MOD, { reason: 'x', duration: 'permanent' })).toMatchObject({
				ok: false,
				refusal: { code: 'invalid_body', field: 'deviationReason' },
			})
			expect(world.bans).toEqual([])
			expect(world.strikes).toEqual([])
		})

		it('keeps the recommendation and the reason for a different step', async () => {
			const { world, strict } = setup(item())
			await strict.run(1, 'queue_ban', MOD, { reason: 'x', duration: 'permanent', deviationReason: 'Ban evasion' })
			expect(world.strikes[0]).toMatchObject({ recommendedStep: '7d', appliedStep: 'permanent', deviationReason: 'Ban evasion' })
			expect(world.staffLog[0]?.detail).toMatchObject({
				strike: { ladder: 'play', recommended: '7d', applied: 'permanent', deviationReason: 'Ban evasion' },
			})
		})

		it('counts a chat ban on the chat ladder and a warning on the ladder staff choose', async () => {
			const { world, strict } = setup(item())
			await strict.run(1, 'chat_mute', MOD, { reason: 'x', duration: '7d' })
			expect(world.strikes[0]?.ladder).toBe('chat')
			const second = setup(item())
			await second.strict.run(1, 'warn', MOD, { reason: 'x', message: 'hi', ladder: 'chat', deviationReason: 'first offence' })
			expect(second.world.strikes[0]).toMatchObject({ ladder: 'chat', warningId: 'w1', appliedStep: 'warning', recommendedStep: '7d' })
		})

		it('refuses a ladder that does not exist', async () => {
			const { strict } = setup(item())
			expect(await strict.run(1, 'warn', MOD, { reason: 'x', message: 'hi', ladder: 'voice' })).toMatchObject({
				ok: false,
				refusal: { code: 'invalid_body', field: 'ladder' },
			})
		})

		it('puts an account ban on no ladder', async () => {
			const { world, strict } = setup(item())
			await strict.run(1, 'account_ban', ADMIN, { reason: 'x', duration: 'permanent' })
			expect(world.strikes).toEqual([])
		})
	})
})

class Rollbackish extends Error {}

