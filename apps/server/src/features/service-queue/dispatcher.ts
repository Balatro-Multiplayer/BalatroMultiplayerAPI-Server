// Runs a moderator's action on a queue item. The order is fixed: load the
// item, check the role table, the body and the claim, pick the target; run
// any external step that must happen first (a void's rating rebuild, an
// overturn's new result -- both idempotent, so a retry after a failed
// commit is safe); then one transaction for the source row, the queue row,
// the ban/warning row and the audit event; then, after the commit, tell
// Nakama (the ban, the warning notification). Every refusal is a value.
import { heldByOther } from './claim.js'
import { type QueueCommand, type SanctionCommand, banTypeOf, parseCommand, presetOf } from './command.js'
import { expiresAtOf } from './durations.js'
import { type OverturnPlan, type Placement, planContestOverturn, planOverturn, ratedPlacements } from './overturn.js'
import { mayLiftBan, permissionFor } from './permissions.js'
import { type QueueRefusal, type QueueResult, refuse } from './refusals.js'
import { type Target, type TargetSources, pickTarget, targetsOf } from './targets.js'
import type { StaffAction, StaffActionEntry } from '../../shared/staff-log/actions.js'
import { type SourceStatus, sourceStatusFor } from './transitions.js'
import {
	type ActionKey,
	type ItemEventKind,
	type ItemStatus,
	type ItemType,
	type StaffRole,
	actorOf,
	isActionKey,
	isItemType,
} from './types.js'

export interface QueueItem {
	id: number
	itemType: string
	sourceId: string
	subjectPlayerId: string | null
	status: string
	claimedBy: string | null
	claimedUntil: Date | null
	// What the item was raised with (types.ts ItemContext); the queue rows carry it.
	context?: unknown
}

export interface Staff {
	playerId: string
	role: StaffRole
}

export interface BanRow {
	id: string
	playerId: string
	banType: 'chat' | 'queue' | 'account'
	expiresAt: Date | null
	reason: string
	issuedBy: string
	issuedAt: Date
	liftedAt: Date | null
	liftedBy: string | null
}

// What void and overturn act on: the run (Nakama's record) and, for a
// matchmade game, its matchmaking_matches row.
export interface GameRef {
	runId: string
	matchmade: boolean
	ranked: boolean
}

export type VoidResult =
	| { kind: 'voided'; rerated: boolean }
	| { kind: 'not_resolved'; status: string }
	| { kind: 'failed'; reason: string }

export type OverturnResult = { kind: 'applied'; rerated: boolean } | { kind: 'failed'; reason: string }

export interface DispatcherDeps<Tx> {
	now(): Date
	getItem(id: number): Promise<QueueItem | null>
	// The report or conflict behind an item, for its targets (null: gone).
	sourcesOf(item: QueueItem): Promise<TargetSources | null>
	playerExists(playerId: string): Promise<boolean>
	getBan(banId: string): Promise<BanRow | null>
	gameOf(item: QueueItem): Promise<GameRef | null>
	conflictOf(item: QueueItem): Promise<Parameters<typeof planOverturn>[0] | null>
	// A contest's run: the players in it, and the result reported before the
	// contest (empty when nobody reported one).
	participantsOf(game: GameRef): Promise<string[]>
	originalResultOf(game: GameRef): Promise<Placement[]>
	flaggedPlayersOf(runId: string): Promise<Set<string>>
	voidGame(game: GameRef): Promise<VoidResult>
	overturnGame(game: GameRef, placements: (Placement & { rated?: boolean })[]): Promise<OverturnResult>

	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
	markResolved(tx: Tx, id: number, actor: string, action: ActionKey, note: string | null, now: Date): Promise<boolean>
	markReopened(tx: Tx, id: number, now: Date): Promise<boolean>
	touch(tx: Tx, id: number, now: Date): Promise<void>
	setSourceStatus(tx: Tx, item: QueueItem, status: SourceStatus, note: string | null): Promise<boolean>
	recordEvent(
		tx: Tx,
		event: { itemId: number; kind: ItemEventKind; actor: string; action: ActionKey | null; note: string | null; detail: unknown },
	): Promise<void>
	insertBan(
		tx: Tx,
		ban: { playerId: string; banType: BanRow['banType']; expiresAt: Date | null; issuedBy: string; reason: string },
	): Promise<BanRow>
	liftBan(tx: Tx, playerId: string, banId: string, liftedBy: string): Promise<BanRow | null>
	// The staff log write (shared/staff-log/actions.ts), in the action's transaction.
	recordStaffAction(tx: Tx, entry: StaffActionEntry): Promise<void>
	insertWarning(tx: Tx, warning: { playerId: string; itemId: number; message: string; issuedBy: string }): Promise<{ id: string }>

	// After the commit; failures are reported in the result, never undone.
	banInNakama(ban: BanRow): Promise<boolean>
	liftBanInNakama(playerId: string, banId: string): Promise<boolean>
	notifyWarned(playerId: string, payload: { message: string; itemType: ItemType; warnedAt: number }): Promise<boolean>
	rescore(item: QueueItem, playerIds: string[]): Promise<void>
}

// The staff log entry of one action, still without the item and the staff member.
type Logged = { reason: string; targetPlayerId?: string | null }

// The log action of each queue action (a note is not logged): the log says
// chat ban and lift where the queue says mute and unban.
const LOGGED_AS: Record<Exclude<ActionKey, 'note'>, StaffAction> = {
	dismiss: 'dismiss',
	resolve: 'resolve',
	warn: 'warn',
	chat_mute: 'chat_ban',
	queue_ban: 'queue_ban',
	account_ban: 'account_ban',
	void: 'void',
	overturn: 'overturn',
	reopen: 'reopen',
	unban: 'lift_ban',
}

export interface ActionEffects {
	ban?: BanRow
	liftedBan?: BanRow
	warningId?: string
	// Whether Nakama took the ban / lift / warning.
	delivered?: boolean
	voided?: { runId: string; rerated: boolean }
	overturned?: { runId: string; placements: Placement[]; rerated: boolean }
}

// How a moderator's action settles a contested run. rate_original: the
// contest was unfounded, so the result reported before it is rated. void: the
// contest stands and no result does.
type ContestSettlement = 'rate_original' | 'void'

export interface ActionOutcome {
	item: QueueItem
	action: ActionKey
	effects: ActionEffects
}

const subjectsOf = (item: QueueItem): string[] => (item.subjectPlayerId ? [item.subjectPlayerId] : [])

// Thrown inside the transaction to roll it back with a refusal.
class Rollback extends Error {
	constructor(readonly refusal: QueueRefusal) {
		super(refusal.code)
	}
}

export function createDispatcher<Tx>(deps: DispatcherDeps<Tx>) {
	type LogFn = (tx: Tx, action: ActionKey, entry: Logged, detail: unknown) => Promise<void>

	async function run(
		itemId: number,
		actionName: string,
		staff: Staff,
		body: Record<string, unknown>,
	): Promise<QueueResult<ActionOutcome>> {
		const item = await deps.getItem(itemId)
		if (!item || !isItemType(item.itemType)) return refuse({ code: 'not_found' })
		if (!isActionKey(actionName)) return refuse({ code: 'unknown_action' })
		const action = actionName
		const itemType = item.itemType
		const status = item.status as ItemStatus

		const parsed = parseCommand(action, body)
		if (!parsed.ok) return refuse({ code: 'invalid_body', ...parsed.refusal })
		const command = parsed.value

		const permission = permissionFor(action, { itemType, status }, staff.role, presetOf(command))
		if (!permission.ok) {
			if (permission.refusal === 'wrong_status') return refuse({ code: 'wrong_status', status })
			return refuse({ code: permission.refusal })
		}

		const now = deps.now()
		if (action !== 'note') {
			const holder = heldByOther(item, staff.playerId, now)
			if (holder) return refuse({ code: 'claimed', claimedBy: holder, claimedUntil: item.claimedUntil })
		}

		const actor = actorOf(staff.role, staff.playerId)
		const log: LogFn = (tx, action, entry, detail) =>
			deps.recordStaffAction(tx, {
				staff: { playerId: staff.playerId, role: staff.role },
				action: LOGGED_AS[action as Exclude<ActionKey, 'note'>],
				itemId: item.id,
				detail,
				...entry,
			})
		try {
			switch (command.action) {
				case 'dismiss':
				case 'resolve':
					return await close(item, itemType, command, actor, now, log)
				case 'note':
					return await note(item, command.note, actor, now)
				case 'reopen':
					return await reopen(item, itemType, command, actor, now, log)
				case 'warn':
					return await warn(item, itemType, command, actor, now, log)
				case 'chat_mute':
				case 'queue_ban':
				case 'account_ban':
					return await sanction(item, itemType, command, actor, now, log)
				case 'unban':
					return await unban(item, staff, command, actor, now, log)
				case 'void':
					return await voidItem(item, itemType, command, actor, now, log)
				case 'overturn':
					return await overturn(item, itemType, command, actor, now, log)
			}
		} catch (err) {
			if (err instanceof Rollback) return refuse(err.refusal)
			throw err
		}
	}

	// Inside a transaction: resolve the queue row (it must still be open),
	// move the source row along, record the event.
	async function closeIn(
		tx: Tx,
		item: QueueItem,
		itemType: ItemType,
		action: ActionKey,
		note: string | null,
		actor: string,
		now: Date,
		detail: unknown,
		log: LogFn,
		logged: Logged,
	): Promise<void> {
		if (!(await deps.markResolved(tx, item.id, actor, action, note, now)))
			throw new Rollback({ code: 'wrong_status', status: 'resolved' })
		const sourceStatus = sourceStatusFor(itemType, action)
		if (sourceStatus && !(await deps.setSourceStatus(tx, item, sourceStatus, note)))
			throw new Rollback({ code: 'source_missing' })
		await deps.recordEvent(tx, { itemId: item.id, kind: 'acted', actor, action, note, detail })
		await log(tx, action, logged, detail)
	}

	async function close(
		item: QueueItem,
		itemType: ItemType,
		command: Extract<QueueCommand, { action: 'dismiss' | 'resolve' }>,
		actor: string,
		now: Date,
		log: LogFn,
	): Promise<QueueResult<ActionOutcome>> {
		const settled = itemType === 'contest' ? await settleContest(item, 'rate_original') : null
		if (settled && !settled.ok) return refuse(settled.refusal)
		await deps.transaction((tx) =>
			closeIn(tx, item, itemType, command.action, command.note, actor, now, settled ? settled.detail : null, log, {
				reason: command.reason,
				targetPlayerId: item.subjectPlayerId,
			}),
		)
		await deps.rescore(item, subjectsOf(item))
		return done(item, command.action, {})
	}

	async function note(item: QueueItem, text: string, actor: string, now: Date): Promise<QueueResult<ActionOutcome>> {
		await deps.transaction(async (tx) => {
			await deps.recordEvent(tx, { itemId: item.id, kind: 'noted', actor, action: 'note', note: text, detail: null })
			await deps.touch(tx, item.id, now)
		})
		return done(item, 'note', {})
	}

	async function reopen(
		item: QueueItem,
		itemType: ItemType,
		command: Extract<QueueCommand, { action: 'reopen' }>,
		actor: string,
		now: Date,
		log: LogFn,
	): Promise<QueueResult<ActionOutcome>> {
		await deps.transaction(async (tx) => {
			if (!(await deps.markReopened(tx, item.id, now))) throw new Rollback({ code: 'wrong_status', status: 'open' })
			const sourceStatus = sourceStatusFor(itemType, 'reopen')
			if (sourceStatus && !(await deps.setSourceStatus(tx, item, sourceStatus, null)))
				throw new Rollback({ code: 'source_missing' })
			await deps.recordEvent(tx, { itemId: item.id, kind: 'reopened', actor, action: 'reopen', note: command.note, detail: null })
			await log(tx, 'reopen', { reason: command.reason, targetPlayerId: item.subjectPlayerId }, null)
		})
		await deps.rescore(item, subjectsOf(item))
		return done(item, 'reopen', {})
	}

	async function targetFor(item: QueueItem, requested: string | null): Promise<Target> {
		const sources = await deps.sourcesOf(item)
		if (!sources) throw new Rollback({ code: 'source_missing' })
		const pick = pickTarget(targetsOf({ itemType: item.itemType, ...sources }), requested)
		if (!pick.ok) throw new Rollback({ code: pick.refusal })
		if (!(await deps.playerExists(pick.target.playerId))) throw new Rollback({ code: 'invalid_target' })
		return pick.target
	}

	async function warn(
		item: QueueItem,
		itemType: ItemType,
		command: Extract<QueueCommand, { action: 'warn' }>,
		actor: string,
		now: Date,
		log: LogFn,
	): Promise<QueueResult<ActionOutcome>> {
		const target = await targetFor(item, command.targetPlayerId)
		const settled = await settleForTarget(item, itemType, target)
		if (settled && !settled.ok) return refuse(settled.refusal)
		const warning = await deps.transaction(async (tx) => {
			const row = await deps.insertWarning(tx, {
				playerId: target.playerId,
				itemId: item.id,
				message: command.message,
				issuedBy: actor,
			})
			await closeIn(tx, item, itemType, 'warn', command.note, actor, now, {
				target,
				warningId: row.id,
				message: command.message,
				...(settled ? settled.detail : {}),
			}, log, { reason: command.reason, targetPlayerId: target.playerId })
			return row
		})
		const delivered = await deps
			.notifyWarned(target.playerId, { message: command.message, itemType, warnedAt: now.getTime() })
			.catch(() => false)
		await deps.rescore(item, [target.playerId])
		return done(item, 'warn', { warningId: warning.id, delivered })
	}

	async function sanction(
		item: QueueItem,
		itemType: ItemType,
		command: SanctionCommand,
		actor: string,
		now: Date,
		log: LogFn,
	): Promise<QueueResult<ActionOutcome>> {
		const target = await targetFor(item, command.targetPlayerId)
		const banType = banTypeOf(command)
		const expiresAt = expiresAtOf(command.duration, now)
		const settled = await settleForTarget(item, itemType, target)
		if (settled && !settled.ok) return refuse(settled.refusal)
		const ban = await deps.transaction(async (tx) => {
			const row = await deps.insertBan(tx, {
				playerId: target.playerId,
				banType,
				expiresAt,
				issuedBy: actor,
				reason: command.reason,
			})
			await closeIn(tx, item, itemType, command.action, command.note, actor, now, {
				target,
				banId: row.id,
				banType,
				duration: command.duration,
				expiresAt,
				...(settled ? settled.detail : {}),
			}, log, { reason: command.reason, targetPlayerId: target.playerId })
			return row
		})
		const delivered = await deps.banInNakama(ban).catch(() => false)
		await deps.rescore(item, [target.playerId])
		return done(item, command.action, { ban, delivered })
	}

	async function unban(
		item: QueueItem,
		staff: Staff,
		command: Extract<QueueCommand, { action: 'unban' }>,
		actor: string,
		now: Date,
		log: LogFn,
	): Promise<QueueResult<ActionOutcome>> {
		const ban = await deps.getBan(command.banId)
		const sources = await deps.sourcesOf(item)
		const targets = sources ? targetsOf({ itemType: item.itemType, ...sources }) : []
		if (!ban || ban.liftedAt || !targets.some((t) => t.playerId === ban.playerId))
			return refuse({ code: 'ban_not_found' })
		if (!mayLiftBan(staff.role, ban.banType)) return refuse({ code: 'forbidden' })
		const lifted = await deps.transaction(async (tx) => {
			const row = await deps.liftBan(tx, ban.playerId, ban.id, actor)
			if (!row) throw new Rollback({ code: 'ban_not_found' })
			await deps.recordEvent(tx, {
				itemId: item.id,
				kind: 'acted',
				actor,
				action: 'unban',
				note: command.note,
				detail: { banId: ban.id, banType: ban.banType, playerId: ban.playerId },
			})
			await log(tx, 'unban', { reason: command.reason, targetPlayerId: ban.playerId }, { banId: ban.id, banType: ban.banType })
			await deps.touch(tx, item.id, now)
			return row
		})
		const delivered = await deps.liftBanInNakama(ban.playerId, ban.id).catch(() => false)
		await deps.rescore(item, [ban.playerId])
		return done(item, 'unban', { liftedBan: lifted, delivered })
	}

	async function voidItem(
		item: QueueItem,
		itemType: ItemType,
		command: Extract<QueueCommand, { action: 'void' }>,
		actor: string,
		now: Date,
		log: LogFn,
	): Promise<QueueResult<ActionOutcome>> {
		const game = await deps.gameOf(item)
		if (!game) return refuse({ code: 'source_missing' })
		let rerated = false
		// A private game has no matchmade record and no ratings: nothing to undo.
		if (game.matchmade) {
			const result = await deps.voidGame(game)
			if (result.kind === 'not_resolved')
				return refuse({ code: 'not_voidable', reason: `The match is ${result.status}, not resolved` })
			if (result.kind === 'failed') return refuse({ code: 'nakama_failed', reason: result.reason })
			rerated = result.rerated
		}
		const voided = { runId: game.runId, rerated }
		await deps.transaction((tx) =>
			closeIn(tx, item, itemType, 'void', command.note, actor, now, { ...voided, matchmade: game.matchmade }, log, {
				reason: command.reason,
				targetPlayerId: item.subjectPlayerId,
			}),
		)
		await deps.rescore(item, subjectsOf(item))
		return done(item, 'void', { voided })
	}

	async function overturn(
		item: QueueItem,
		itemType: ItemType,
		command: Extract<QueueCommand, { action: 'overturn' }>,
		actor: string,
		now: Date,
		log: LogFn,
	): Promise<QueueResult<ActionOutcome>> {
		const [conflict, game] = await Promise.all([
			itemType === 'contest' ? null : deps.conflictOf(item),
			deps.gameOf(item),
		])
		if (!game || (itemType !== 'contest' && !conflict)) return refuse({ code: 'source_missing' })
		// A contest names the winner; a conflict names the report that stands.
		const plan: OverturnPlan = conflict
			? planOverturn(conflict, command.toReportOf)
			: planContestOverturn(await deps.participantsOf(game), command.toReportOf)
		if (!plan.ok) return refuse({ code: plan.refusal })
		const flagged = game.ranked ? await deps.flaggedPlayersOf(game.runId) : new Set<string>()
		const result = await deps.overturnGame(game, ratedPlacements(plan.placements, flagged, game.ranked))
		if (result.kind === 'failed') return refuse({ code: 'nakama_failed', reason: result.reason })
		const overturned = { runId: game.runId, placements: plan.placements, rerated: result.rerated }
		await deps.transaction((tx) =>
			closeIn(tx, item, itemType, 'overturn', command.note, actor, now, overturned, log, {
				reason: command.reason,
				targetPlayerId: item.subjectPlayerId,
			}),
		)
		await deps.rescore(item, subjectsOf(item))
		return done(item, 'overturn', { overturned })
	}

	// Settles a contested run's ratings before the item closes. Both settlements
	// are idempotent (a void rebuilds again, a re-set result is a no-op), so a
	// retry after a failed commit is safe.
	async function settleContest(
		item: QueueItem,
		how: ContestSettlement,
	): Promise<{ ok: true; detail: { settled: ContestSettlement; runId: string } } | { ok: false; refusal: QueueRefusal }> {
		const game = await deps.gameOf(item)
		if (!game) return { ok: false, refusal: { code: 'source_missing' } }
		const detail = { settled: how, runId: game.runId }
		// Only a matchmade game has ratings to settle.
		if (!game.matchmade) return { ok: true, detail }
		if (how === 'void') {
			const result = await deps.voidGame(game)
			if (result.kind === 'not_resolved')
				return { ok: false, refusal: { code: 'not_voidable', reason: `The match is ${result.status}, not resolved` } }
			if (result.kind === 'failed') return { ok: false, refusal: { code: 'nakama_failed', reason: result.reason } }
			return { ok: true, detail }
		}
		const original = await deps.originalResultOf(game)
		// Nobody reported before the contest: there is no result to rate.
		if (original.length < 2) return { ok: true, detail }
		const flagged = game.ranked ? await deps.flaggedPlayersOf(game.runId) : new Set<string>()
		const result = await deps.overturnGame(game, ratedPlacements(original, flagged, game.ranked))
		if (result.kind === 'failed') return { ok: false, refusal: { code: 'nakama_failed', reason: result.reason } }
		return { ok: true, detail }
	}

	// A punishment on a contest: the contester's means the contest was unfounded;
	// anyone else's means it stands.
	async function settleForTarget(item: QueueItem, itemType: ItemType, target: Target) {
		if (itemType !== 'contest') return null
		return settleContest(item, target.role === 'contester' ? 'rate_original' : 'void')
	}

	async function done(item: QueueItem, action: ActionKey, effects: ActionEffects): Promise<QueueResult<ActionOutcome>> {
		const fresh = (await deps.getItem(item.id)) ?? item
		return { ok: true, value: { item: fresh, action, effects } }
	}

	return { run }
}

export type Dispatcher = ReturnType<typeof createDispatcher>
