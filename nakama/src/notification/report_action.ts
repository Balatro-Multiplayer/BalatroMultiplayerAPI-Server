// Telling a reporter that staff acted on their Report, for the
// admin_report_action RPC.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { parsePayload, requireServer } from '../rpc'
import { NotificationKind } from './kinds'
import { sendNotification } from './store'

// {userId} -> {}: staff punished a player this user reported. The API decides
// when (once per report); this only stores and pushes the Notification.
export function rpcAdminReportAction(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const userId = parsePayload(payload).userId
	if (typeof userId !== 'string' || userId === '')
		throw runtimeError(INVALID_ARGUMENT, 'userId is required')
	sendNotification(nk, userId, NotificationKind.REPORT_ACTION, {})
	return '{}'
}
