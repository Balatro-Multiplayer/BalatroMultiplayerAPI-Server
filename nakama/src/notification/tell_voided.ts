// Telling the players of a voided match, for the admin_run_tell_voided RPC.
import { RUNS_COLLECTION, SYSTEM_USER_ID } from '../lobby/protocol'
import { readRun } from '../lobby/storage'
import { parsePayload, requireServer } from '../rpc'
import { planResultNotifications } from './result_change'
import { sendNotification } from './store'

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
