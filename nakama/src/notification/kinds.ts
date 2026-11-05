// What a Notification can be about. A new event adds a kind here and its
// params type below, sends it with sendNotification, and adds its wording to
// the client (MPAPI ui/notification_kinds.lua). Nothing else changes: storage,
// expiry, the chat line and the login overlays are the same for every kind.
import type { LateResult, RankedResult } from '../lobby/late_result'

export const NotificationKind = {
	// A pending result ended after the player left.
	RESULT_LATE: 'result_late',
	// A ranked result, told to every player it rated.
	RESULT_RANKED: 'result_ranked',
	// A player withdrew their in-game Contest: the other players are told.
	CONTEST_WITHDRAWN: 'contest_withdrawn',
} as const

export type NotificationKindName =
	(typeof NotificationKind)[keyof typeof NotificationKind]

export interface NotificationParams {
	result_late: LateResult
	result_ranked: RankedResult
	contest_withdrawn: ContestWithdrawn
}

export type ResultOutcome = 'win' | 'draw' | 'loss'

// What the player's result became once the contester forfeited.
export interface ContestWithdrawn {
	runId: string
	outcome: ResultOutcome
}

export interface StoredNotification {
	id: string
	kind: NotificationKindName
	params: { [key: string]: unknown }
	sentAt: number
}
