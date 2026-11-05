// A player withdrew their in-game Contest, which is their forfeit. The API
// has already set the new result; this tells each other player of the match
// what that result is for them.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { readRun } from '../lobby/storage'
import { parsePayload, requireServer } from '../rpc'
import { NotificationKind } from './kinds'
import { outcomeOf } from './result_change'
import { sendNotification } from './store'

// {runId, contesterId} -> {told: number}. The contester is told nothing.
export function rpcAdminContestWithdrawn(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	if (typeof input.contesterId !== 'string' || input.contesterId === '')
		throw runtimeError(INVALID_ARGUMENT, 'contesterId is required')
	const run = readRun(nk, input.runId)
	let told = 0
	for (const player of run.players) {
		if (player.id === input.contesterId) continue
		const outcome = outcomeOf(run.placements, player.id)
		if (!outcome) continue
		sendNotification(nk, player.id, NotificationKind.CONTEST_WITHDRAWN, {
			runId: run.runId,
			outcome,
		})
		told++
	}
	return JSON.stringify({ told })
}
