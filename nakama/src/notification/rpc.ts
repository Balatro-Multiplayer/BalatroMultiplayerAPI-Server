// Player RPCs for the Notification store: list the unread ones at login, mark
// them read as the client shows them.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { RUNS_COLLECTION, SYSTEM_USER_ID } from '../lobby/protocol'
import { readRun } from '../lobby/storage'
import { parsePayload, requireServer, requireUser } from '../rpc'
import { planResultNotifications } from './result_change'
import {
	listNotifications,
	markNotificationsRead,
	sendNotification,
} from './store'

const MAX_IDS = 100

// {} -> {notifications: [{id, kind, params, sentAt}]}, oldest first.
export function rpcNotificationsPending(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	return JSON.stringify({ notifications: listNotifications(nk, userId) })
}

// {ids: string[]} -> {}.
export function rpcNotificationsRead(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const ids = parsePayload(payload).ids
	if (
		!Array.isArray(ids) ||
		ids.length > MAX_IDS ||
		ids.some((id) => typeof id !== 'string')
	)
		throw runtimeError(
			INVALID_ARGUMENT,
			'Missing or invalid ids (array of strings)',
		)
	markNotificationsRead(nk, userId, ids as string[])
	return '{}'
}

// {runId} -> {told}: a contest was decided with no result to rate, so the
// match counts for nobody. Tells each player of the run it was voided, once
// (the run keeps who was told). The run itself is not changed otherwise.
export function rpcAdminRunTellVoided(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const run = readRun(nk, parsePayload(payload).runId)
	const plan = planResultNotifications(
		run,
		{ ...run, voided: { at: Date.now() } },
		false,
	)
	if (plan.sends.length > 0) {
		nk.storageWrite([
			{
				collection: RUNS_COLLECTION,
				key: run.runId,
				userId: SYSTEM_USER_ID,
				value: { ...run, told: plan.told } as unknown as {
					[key: string]: unknown
				},
				permissionRead: 2,
				permissionWrite: 0,
			},
		])
		for (const send of plan.sends)
			sendNotification(nk, send.userId, send.kind, send.params as never)
	}
	return JSON.stringify({ told: plan.sends.length })
}
