// The appeal service wired to Postgres, the service queue and Nakama.
import { db } from '../../infrastructure/db/index.js'
import type { DbTransaction } from '../../infrastructure/db/executor.js'
import {
	appealHistory,
	findPunishmentRef,
	getAppealById,
	insertAppeal,
	markAppealNotified,
	liftWarning,
	setBanEnd,
	settleAppealRow,
} from '../../infrastructure/gateways/appeal.gateway.js'
import { liftBan, markBanEndNotified } from '../../infrastructure/gateways/ban.gateway.js'
import {
	enqueueServiceQueueItem,
	getServiceQueueItemById,
	markServiceQueueItemResolved,
	recordItemEvent,
} from '../../infrastructure/gateways/service-queue.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import {
	banInNakama,
	liftBanInNakama,
	liftNetworkBanInNakama,
	notifyAppealDecidedInNakama,
} from '../../infrastructure/nakama/moderation-sync.js'
import { type AppealDeps, type PunishmentRef, createAppealService } from './appeals.service.js'

const deps: AppealDeps<DbTransaction> = {
	now: () => new Date(),
	async findPunishment(playerId, punishmentId) {
		const ref = await findPunishmentRef(punishmentId)
		return ref && ref.playerId === playerId ? ref : null
	},
	punishmentById: (id) => findPunishmentRef(id),
	historyFor: (playerId, punishmentId) => appealHistory(playerId, punishmentId),
	insertAppeal: (data) => insertAppeal(data),
	async enqueue(appeal, summary) {
		await enqueueServiceQueueItem({
			itemType: 'appeal',
			sourceId: appeal.id,
			subjectPlayerId: appeal.playerId,
			summary,
		})
	},
	getItem: (id) => getServiceQueueItemById(id),
	getAppeal: (id) => getAppealById(id),

	transaction: (fn) => db.transaction(fn),
	async markResolved(tx, itemId, actor, action, note, now) {
		return !!(await markServiceQueueItemResolved(tx, itemId, actor, action, note, now))
	},
	settleAppeal: (tx, id, decision) => settleAppealRow(tx, id, decision),
	async liftPunishment(tx, punishment, liftedBy) {
		let lifted: boolean
		if (punishment.kind === 'ban') {
			lifted = !!(await liftBan(punishment.playerId, punishment.id, liftedBy, tx))
			// The appeal's Notification covers it: no separate "ban ended".
			if (lifted) await markBanEndNotified(punishment.id, tx)
		} else {
			lifted = await liftWarning(tx, punishment.id, liftedBy)
		}
		return lifted ? { ...punishment, liftedAt: new Date() } : null
	},
	async shortenBan(tx, punishment, expiresAt) {
		return (await setBanEnd(tx, punishment.id, expiresAt)) ? { ...punishment, expiresAt } : null
	},
	recordEvent: (tx, event) => recordItemEvent(tx, event),
	recordStaffAction: (tx, entry) => recordStaffAction(tx, entry),

	banInNakama: (ban: PunishmentRef) =>
		banInNakama({
			id: ban.id,
			playerId: ban.playerId,
			banType: ban.banType!,
			expiresAt: ban.expiresAt,
			issuedBy: ban.issuedBy,
			issuedAt: new Date(),
			reason: ban.reason,
			liftedAt: null,
			liftedBy: null,
		}),
	liftBanInNakama: (playerId, banId) => liftBanInNakama(playerId, banId),
	markNotified: (id) => markAppealNotified(id),
	notifyDecided: (decided) => notifyAppealDecidedInNakama(decided),
	async liftNetworkBans(banIds) {
		for (const banId of banIds) {
			const result = await liftNetworkBanInNakama(banId)
			// Already lifted is fine; an unreachable Nakama is not.
			if (!result.ok && result.error === 'unavailable') return { ok: false }
		}
		return { ok: true }
	},
}

export const appealService = createAppealService(deps)
