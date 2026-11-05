// Appeals: a player's written request to lift or shorten a punishment, or to
// lift the network ban that blocks them. Each appeal is also a service queue
// item. A moderator can deny one, but not one of a punishment they gave
// themselves; only an admin can grant one. Nakama calls run after the commit,
// except lifting a network ban, which runs first and is safe to repeat.
import type { StaffActionEntry } from '../../shared/staff-log/actions.js'
import { parseReason } from '../../shared/staff-log/actions.js'
import { heldByOther } from '../service-queue/claim.js'
import { type QueueRefusal, type QueueResult, refuse } from '../service-queue/refusals.js'
import type { QueueItem, Staff } from '../service-queue/dispatcher.js'
import { actorOf, isBanDuration } from '../service-queue/types.js'
import { type AppealRefusal, type AppealStatus, canSubmitAppeal, decisionsFor, shortenedEnd } from './appeal-rules.js'

export const MAX_APPEAL_LENGTH = 2000

export type BanKind = 'chat' | 'queue' | 'account' | 'username'

// A punishment as the appeal rules see it: a ban or a warning.
export interface PunishmentRef {
	id: string
	playerId: string
	kind: 'ban' | 'warning'
	banType: BanKind | null
	issuedBy: string
	reason: string
	expiresAt: Date | null
	liftedAt: Date | null
}

export type AppealOutcome = 'lifted' | 'shortened'

export interface AppealRow {
	id: string
	playerId: string
	targetKind: 'punishment' | 'network_ban'
	punishmentId: string | null
	networkBanIds: string[]
	message: string
	status: AppealStatus
	decisionReason: string | null
	outcome: AppealOutcome | null
	decidedBy: string | null
	decidedAt: Date | null
	createdAt: Date
}

export type NewAppeal = Pick<AppealRow, 'playerId' | 'targetKind' | 'punishmentId' | 'networkBanIds' | 'message'>

export interface AppealDecision {
	status: 'denied' | 'granted'
	decisionReason: string
	outcome: AppealOutcome | null
	decidedBy: string
	decidedAt: Date
}

export interface AppealDeps<Tx> {
	now(): Date
	// The player's own punishment by id (null: not theirs, or gone).
	findPunishment(playerId: string, punishmentId: string): Promise<PunishmentRef | null>
	punishmentById(punishmentId: string): Promise<PunishmentRef | null>
	// Every appeal the player made for the punishment (null: for the network ban).
	historyFor(playerId: string, punishmentId: string | null): Promise<AppealRow[]>
	insertAppeal(appeal: NewAppeal): Promise<AppealRow>
	// Puts the appeal in the service queue.
	enqueue(appeal: AppealRow, summary: string): Promise<void>
	getItem(id: number): Promise<QueueItem | null>
	getAppeal(id: string): Promise<AppealRow | null>

	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
	markResolved(tx: Tx, itemId: number, actor: string, action: string, note: string | null, now: Date): Promise<boolean>
	// False when the appeal is no longer open.
	settleAppeal(tx: Tx, appealId: string, decision: AppealDecision): Promise<boolean>
	liftPunishment(tx: Tx, punishment: PunishmentRef, liftedBy: string): Promise<PunishmentRef | null>
	shortenBan(tx: Tx, punishment: PunishmentRef, expiresAt: Date): Promise<PunishmentRef | null>
	recordEvent(
		tx: Tx,
		event: { itemId: number; kind: 'acted'; actor: string; action: string; note: string | null; detail: unknown },
	): Promise<void>
	recordStaffAction(tx: Tx, entry: StaffActionEntry): Promise<void>

	// After the commit; failures are logged by the caller, never undone.
	banInNakama(ban: PunishmentRef): Promise<boolean>
	liftBanInNakama(playerId: string, banId: string): Promise<boolean>
	// Before the commit. ok: false when Nakama cannot say the bans are lifted.
	liftNetworkBans(banIds: string[]): Promise<{ ok: boolean }>
	// After the commit; the player's Notification of the decision. Sent once
	// per appeal, failures are logged by the caller, never undone.
	notifyDecided(decided: AppealNotice): Promise<boolean>
	// After Nakama confirmed; the timed job retries every decided appeal not marked.
	markNotified(appealId: string): Promise<void>
}

export interface AppealNotice {
	playerId: string
	appealId: string
	accepted: boolean
	target: BanKind | 'warning' | 'network'
	result: AppealOutcome | null
}

export type SubmitRefusal =
	| { code: 'invalid_message'; message: string }
	| { code: 'not_found' }
	| { code: 'already_lifted' }
	| { code: 'not_blocked' }
	| AppealRefusal

export interface SubmitInput {
	playerId: string
	// null: the appeal is of the network ban that blocks the player.
	punishmentId: string | null
	message: string
	// The network bans covering the player's address now (from Nakama).
	networkBanIds: string[]
}

export type DecideBody = Record<string, unknown>

const PUNISHMENT_NAME: Record<BanKind, string> = {
	chat: 'chat ban',
	queue: 'queue ban',
	account: 'account ban',
	username: 'username ban',
}

function summaryOf(appeal: NewAppeal, punishment: PunishmentRef | null): string {
	const what = punishment ? (punishment.banType ? PUNISHMENT_NAME[punishment.banType] : 'warning') : 'network ban'
	const text = appeal.message.replace(/\s+/g, ' ')
	return `Appeal of a ${what}: ${text.length > 80 ? `${text.slice(0, 77)}...` : text}`
}

export function createAppealService<Tx>(deps: AppealDeps<Tx>) {
	async function submit(
		input: SubmitInput,
	): Promise<{ ok: true; value: AppealRow } | { ok: false; refusal: SubmitRefusal }> {
		const message = input.message.trim()
		if (!message) return { ok: false, refusal: { code: 'invalid_message', message: 'message is required' } }
		if (message.length > MAX_APPEAL_LENGTH)
			return { ok: false, refusal: { code: 'invalid_message', message: `message is over ${MAX_APPEAL_LENGTH} characters` } }

		let punishment: PunishmentRef | null = null
		if (input.punishmentId !== null) {
			punishment = await deps.findPunishment(input.playerId, input.punishmentId)
			if (!punishment) return { ok: false, refusal: { code: 'not_found' } }
			if (punishment.liftedAt) return { ok: false, refusal: { code: 'already_lifted' } }
		} else if (input.networkBanIds.length === 0) {
			return { ok: false, refusal: { code: 'not_blocked' } }
		}

		const now = deps.now()
		const allowed = canSubmitAppeal(await deps.historyFor(input.playerId, input.punishmentId), now)
		if (!allowed.ok) return { ok: false, refusal: allowed.refusal }

		const data: NewAppeal = {
			playerId: input.playerId,
			targetKind: punishment ? 'punishment' : 'network_ban',
			punishmentId: input.punishmentId,
			networkBanIds: punishment ? [] : input.networkBanIds,
			message,
		}
		const appeal = await deps.insertAppeal(data)
		await deps.enqueue(appeal, summaryOf(data, punishment))
		return { ok: true, value: appeal }
	}

	async function decide(
		itemId: number,
		staff: Staff,
		body: DecideBody,
	): Promise<QueueResult<{ appeal: AppealRow }>> {
		const item = await deps.getItem(itemId)
		if (!item || item.itemType !== 'appeal') return refuse({ code: 'not_found' })
		if (item.status !== 'open') return refuse({ code: 'wrong_status', status: item.status })
		const appeal = await deps.getAppeal(item.sourceId)
		if (!appeal) return refuse({ code: 'source_missing' })
		const punishment = appeal.punishmentId ? await deps.punishmentById(appeal.punishmentId) : null
		if (appeal.punishmentId && !punishment) return refuse({ code: 'source_missing' })

		const decision = body.decision
		if (decision !== 'deny' && decision !== 'grant')
			return refuse({ code: 'invalid_body', field: 'decision', message: "decision must be 'deny' or 'grant'" })
		const may = decisionsFor(staff, punishment?.issuedBy ?? null)
		if (!(decision === 'deny' ? may.deny : may.grant)) return refuse({ code: 'forbidden' })

		const why = parseReason(body.reason)
		if (!why.ok) return refuse({ code: 'invalid_body', field: 'reason', message: why.message })

		const now = deps.now()
		const holder = heldByOther(item, staff.playerId, now)
		if (holder) return refuse({ code: 'claimed', claimedBy: holder, claimedUntil: item.claimedUntil })

		const actor = actorOf(staff.role, staff.playerId)
		const base = { decisionReason: why.reason, decidedBy: actor, decidedAt: now }

		const target: AppealNotice['target'] = punishment ? (punishment.banType ?? 'warning') : 'network'
		const tell = async (accepted: boolean, result: AppealOutcome | null) => {
			const sent = await deps
				.notifyDecided({ playerId: appeal.playerId, appealId: appeal.id, accepted, target, result })
				.catch(() => false)
			if (sent) await deps.markNotified(appeal.id).catch(() => undefined)
		}
		const decided = (status: 'denied' | 'granted', outcome: AppealOutcome | null): AppealDecision => ({ ...base, status, outcome })
		const result = (d: AppealDecision) => ({ ok: true as const, value: { appeal: { ...appeal, ...d } } })

		if (decision === 'deny') {
			const done = await commit((tx) => settle(tx, item, appeal, decided('denied', null), 'appeal_deny', {}))
			if (!done.ok) return refuse(done.refusal)
			await tell(false, null)
			return result(decided('denied', null))
		}

		const outcome = body.outcome
		if (outcome !== 'lift' && outcome !== 'shorten')
			return refuse({ code: 'invalid_body', field: 'outcome', message: "outcome must be 'lift' or 'shorten'" })

		if (outcome === 'shorten') {
			// A warning has no length to shorten, and a network ban has no length at all.
			if (!punishment?.banType)
				return refuse({ code: 'invalid_body', field: 'outcome', message: 'only a ban can be shortened' })
			// A username ban is permanent and ends only by a lift.
			if (punishment.banType === 'username')
				return refuse({ code: 'invalid_body', field: 'outcome', message: 'a username ban can only be lifted' })
			const duration = body.duration
			const end = isBanDuration(duration) ? shortenedEnd(duration, punishment.expiresAt, now) : { ok: false as const }
			if (!end.ok)
				return refuse({
					code: 'invalid_body',
					field: 'duration',
					message: 'duration must be 24h, 7d or 30d, and end before the ban does',
				})
			if (punishment.liftedAt) return refuse({ code: 'unchanged' })
			const done = await commit(async (tx) => {
				const row = await deps.shortenBan(tx, punishment, end.expiresAt)
				if (!row) throw new Rollback({ code: 'unchanged' })
				const detail = { punishmentId: punishment.id, outcome: 'shortened', duration, expiresAt: end.expiresAt }
				await settle(tx, item, appeal, decided('granted', 'shortened'), 'appeal_grant', detail)
				return row
			})
			if (!done.ok) return refuse(done.refusal)
			await deps.banInNakama(done.value).catch(() => false)
			await tell(true, 'shortened')
			return result(decided('granted', 'shortened'))
		}

		if (!punishment) {
			const lifted = await deps.liftNetworkBans(appeal.networkBanIds)
			if (!lifted.ok) return refuse({ code: 'nakama_failed', reason: 'the network ban could not be lifted' })
			const detail = { outcome: 'lifted', networkBanIds: appeal.networkBanIds }
			const done = await commit((tx) => settle(tx, item, appeal, decided('granted', 'lifted'), 'appeal_grant', detail))
			if (!done.ok) return refuse(done.refusal)
			await tell(true, 'lifted')
			return result(decided('granted', 'lifted'))
		}

		if (punishment.liftedAt) return refuse({ code: 'unchanged' })
		const done = await commit(async (tx) => {
			if (!(await deps.liftPunishment(tx, punishment, actor))) throw new Rollback({ code: 'unchanged' })
			const detail = { punishmentId: punishment.id, outcome: 'lifted' }
			await settle(tx, item, appeal, decided('granted', 'lifted'), 'appeal_grant', detail)
		})
		if (!done.ok) return refuse(done.refusal)
		if (punishment.kind === 'ban') await deps.liftBanInNakama(punishment.playerId, punishment.id).catch(() => false)
		await tell(true, 'lifted')
		return result(decided('granted', 'lifted'))
	}

	async function commit<T>(
		fn: (tx: Tx) => Promise<T>,
	): Promise<{ ok: true; value: T } | { ok: false; refusal: QueueRefusal }> {
		try {
			return { ok: true, value: await deps.transaction(fn) }
		} catch (err) {
			if (err instanceof Rollback) return { ok: false, refusal: err.refusal }
			throw err
		}
	}

	// Inside a transaction: close the queue item, settle the appeal, write the
	// event and the staff log entry. A stale open check rolls everything back.
	async function settle(
		tx: Tx,
		item: QueueItem,
		appeal: AppealRow,
		decision: AppealDecision,
		action: 'appeal_deny' | 'appeal_grant',
		detail: Record<string, unknown>,
	): Promise<void> {
		const staffRole = decision.decidedBy.slice(0, decision.decidedBy.indexOf(':')) as Staff['role']
		const staffId = decision.decidedBy.slice(decision.decidedBy.indexOf(':') + 1)
		if (!(await deps.markResolved(tx, item.id, decision.decidedBy, action, decision.decisionReason, decision.decidedAt)))
			throw new Rollback({ code: 'wrong_status', status: 'resolved' })
		if (!(await deps.settleAppeal(tx, appeal.id, decision))) throw new Rollback({ code: 'wrong_status', status: 'resolved' })
		await deps.recordEvent(tx, {
			itemId: item.id,
			kind: 'acted',
			actor: decision.decidedBy,
			action,
			note: decision.decisionReason,
			detail: { appealId: appeal.id, ...detail },
		})
		await deps.recordStaffAction(tx, {
			staff: { playerId: staffId, role: staffRole },
			action,
			reason: decision.decisionReason,
			targetPlayerId: appeal.playerId,
			itemId: item.id,
			detail: { appealId: appeal.id, ...detail },
		})
	}

	return { submit, decide }
}

export type AppealService = ReturnType<typeof createAppealService>

class Rollback extends Error {
	constructor(readonly refusal: QueueRefusal) {
		super(refusal.code)
	}
}
