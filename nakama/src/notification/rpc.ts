// Player RPCs for the Notification store: list the unread ones at login, mark
// them read as the client shows them.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { parsePayload, requireUser } from '../rpc'
import { listNotifications, markNotificationsRead } from './store'

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
