// Telling a player an appeal was decided, or that a ban ended. The API decides
// when (an appeal settles, or its timed job finds a ban that ran out or was
// lifted) and calls admin_punishment_notify. The key (the appeal id or the ban
// id) is recorded per player, so a repeated call after a failure never sends a
// second Notification.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { parsePayload, requireServer } from '../rpc'
import {
	NotificationKind,
	type AppealDecided,
	type AppealTarget,
	type BanKindName,
	type PunishmentEnded,
} from './kinds'
import { sendNotification } from './store'

export const PUNISHMENT_NOTIFIED_COLLECTION = 'punishment_notified'
const USER_ID_PATTERN = /^[0-9a-f-]{36}$/
const BAN_KINDS: readonly string[] = ['chat', 'queue', 'account', 'username']
const TARGETS: readonly string[] = [...BAN_KINDS, 'warning', 'network']
const MAX_KEY_LENGTH = 100

function parseAppeal(value: unknown): AppealDecided | undefined {
	if (typeof value !== 'object' || value === null) return undefined
	const { accepted, target, result } = value as { [key: string]: unknown }
	if (typeof accepted !== 'boolean') return undefined
	if (typeof target !== 'string' || !TARGETS.includes(target)) return undefined
	if (!accepted) return { accepted, target: target as AppealTarget, result: null }
	if (result !== 'lifted' && result !== 'shortened') return undefined
	return { accepted, target: target as AppealTarget, result }
}

function parseEnded(value: unknown): PunishmentEnded | undefined {
	if (typeof value !== 'object' || value === null) return undefined
	const { ban } = value as { [key: string]: unknown }
	if (typeof ban !== 'string' || !BAN_KINDS.includes(ban)) return undefined
	return { ban: ban as BanKindName }
}

// {userId, kind: 'appeal_decided' | 'punishment_ended', key, params} ->
// {sent}. sent is false when this key was already told for the player.
export function rpcAdminPunishmentNotify(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const { userId, kind, key } = input
	if (typeof userId !== 'string' || !USER_ID_PATTERN.test(userId))
		throw runtimeError(INVALID_ARGUMENT, 'Invalid userId')
	if (typeof key !== 'string' || key === '' || key.length > MAX_KEY_LENGTH)
		throw runtimeError(INVALID_ARGUMENT, 'Invalid key')
	if (kind !== NotificationKind.APPEAL_DECIDED && kind !== NotificationKind.PUNISHMENT_ENDED)
		throw runtimeError(INVALID_ARGUMENT, 'Invalid kind')
	const appeal = kind === NotificationKind.APPEAL_DECIDED ? parseAppeal(input.params) : undefined
	const ended = kind === NotificationKind.PUNISHMENT_ENDED ? parseEnded(input.params) : undefined
	if (!appeal && !ended) throw runtimeError(INVALID_ARGUMENT, 'Invalid params')

	const recordKey = `${kind}:${key}`
	const done = nk.storageRead([
		{ collection: PUNISHMENT_NOTIFIED_COLLECTION, key: recordKey, userId },
	])
	if (done.length > 0) return JSON.stringify({ sent: false })
	if (appeal) sendNotification(nk, userId, NotificationKind.APPEAL_DECIDED, appeal)
	else sendNotification(nk, userId, NotificationKind.PUNISHMENT_ENDED, ended!)
	nk.storageWrite([
		{
			collection: PUNISHMENT_NOTIFIED_COLLECTION,
			key: recordKey,
			userId,
			value: { at: Date.now() },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
	logger.info('Told %s of %s %s', userId, kind, key)
	return JSON.stringify({ sent: true })
}
