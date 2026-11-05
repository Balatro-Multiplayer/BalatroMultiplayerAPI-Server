// Telling a player who left a run early how it ended. A run whose result was
// pending settles after they are gone; the stored run already places them and
// rates them, so match history shows it. A player who is online also gets a
// notification, which the client prints in chat.
import { NotificationKind } from '../notification/kinds'
import { sendNotification } from '../notification/store'
import { NotifyCode, notify } from '../notify'
import type { RatingResult, RunRecord } from './protocol'

export interface LateResult {
	runId: string
	code: string
	modId: string
	status: string
	place: number | null
	rating: RatingResult | null
}

export interface RankedResult extends LateResult {
	tied: boolean
	players: number
}

export function lateResultContent(
	run: RunRecord,
	playerId: string,
): LateResult {
	const placement = run.placements.filter((p) => p.playerId === playerId)[0]
	return {
		runId: run.runId,
		code: run.code,
		modId: run.modId,
		status: run.status,
		place: placement ? placement.place : null,
		rating: (run.ratings && run.ratings[playerId]) || null,
	}
}

// Stored, so a player who is offline reads it at their next login. Online
// players of an older client still get the transient 110.
export function sendLateResults(
	nk: nkruntime.Nakama,
	run: RunRecord,
	playerIds: string[],
) {
	for (const playerId of playerIds) {
		const content = lateResultContent(run, playerId)
		sendNotification(nk, playerId, NotificationKind.RESULT_LATE, content)
		notify(
			nk,
			playerId,
			NotifyCode.RESULT_LATE,
			'result_late',
			{ ...content },
			false,
		)
	}
}

// A settled ranked run, told to each player who was rated by it. `tied` is a
// shared first place (a draw); `players` is how many were in the run (a client
// says the place, not win or loss, past two).
export function rankedResultContent(
	run: RunRecord,
	playerId: string,
): RankedResult {
	const first = run.placements.filter((p) => p.place === 1)
	return {
		...lateResultContent(run, playerId),
		tied: first.length > 1,
		players: run.players.length,
	}
}

// Stored, so a player who left first reads it (with their rating change) at
// their next login. Older clients still get the transient 111.
export function sendRankedResults(nk: nkruntime.Nakama, run: RunRecord) {
	if (!run.rankedMode) return
	for (const player of run.players) {
		if (!run.ratings || !run.ratings[player.id]) continue
		const content = rankedResultContent(run, player.id)
		sendNotification(nk, player.id, NotificationKind.RESULT_RANKED, content)
		notify(
			nk,
			player.id,
			NotifyCode.RESULT_RANKED,
			'result_ranked',
			{ ...content },
			false,
		)
	}
}
