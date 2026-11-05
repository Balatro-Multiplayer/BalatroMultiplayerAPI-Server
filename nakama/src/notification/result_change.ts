// Who is told when staff change a finished match: void it, set its result, or
// decide a contest on it. Pure: the run before and after the edit in, the
// Notifications to send and the new "told" record out. A player is told only
// when their outcome differs from what they were last told (or, for a run
// never told about, from the result they already had), so deciding a reopened
// item the same way sends nothing.
import type { Placement, RunRecord } from '../lobby/protocol'
import {
	NotificationKind,
	type NotificationKindName,
	type NotificationParams,
	type ResultOutcome,
	type TellOutcome,
} from './kinds'

export interface ResultNotification {
	userId: string
	kind: NotificationKindName
	params: NotificationParams[NotificationKindName]
}

export function outcomeOf(
	placements: Placement[],
	playerId: string,
): ResultOutcome | null {
	const own = placements.find((p) => p.playerId === playerId)
	if (!own) return null
	const places = placements.map((p) => p.place)
	const best = Math.min(...places)
	if (own.place !== best) return 'loss'
	return Math.max(...places) === best && placements.length > 1 ? 'draw' : 'win'
}

// What the player already knows about the run.
function knownOutcome(
	before: RunRecord,
	playerId: string,
	contesters: readonly string[],
): TellOutcome | null {
	const told = before.told?.[playerId]
	if (told) return told
	if (before.voided) return 'void'
	// A contested run has no result yet, whatever was reported before the contest.
	if (before.status === 'contested') return null
	// A website Contest leaves the result standing, but the player has not been
	// told the Contest was decided: that is news even when the result is kept.
	if (contesters.length > 0) return null
	return outcomeOf(before.placements, playerId)
}

function outcomeAfter(after: RunRecord, playerId: string): TellOutcome | null {
	return after.voided ? 'void' : outcomeOf(after.placements, playerId)
}

export function planResultNotifications(
	before: RunRecord,
	after: RunRecord,
	decidesContest: boolean,
	// The players whose Contests stand (Nakama ids), from the API's contests
	// list; empty for a decision that rests on the run's own in-game Contest.
	contesters: readonly string[] = [],
): { sends: ResultNotification[]; told: { [userId: string]: TellOutcome } } {
	const sends: ResultNotification[] = []
	const told: { [userId: string]: TellOutcome } = { ...before.told }
	const standing = decidesContest ? contesters : []
	const contest = decidesContest ? before.contest : undefined
	const contestDecided = !!contest || standing.length > 0
	for (const player of before.players) {
		const now = outcomeAfter(after, player.id)
		if (!now) continue
		if (now === knownOutcome(before, player.id, standing)) continue
		told[player.id] = now
		if (now === 'void') {
			sends.push({
				userId: player.id,
				kind: NotificationKind.RESULT_VOIDED,
				params: {},
			})
		} else if (contestDecided) {
			sends.push({
				userId: player.id,
				kind: NotificationKind.CONTEST_DECIDED,
				params: {
					role:
						standing.includes(player.id) || contest?.by === player.id
							? 'contester'
							: 'opponent',
					outcome: now,
				},
			})
		} else {
			sends.push({
				userId: player.id,
				kind: NotificationKind.RESULT_CHANGED,
				params: { outcome: now },
			})
		}
	}
	return { sends, told }
}
