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
	// A season ended: the player's place and rating on each board they are on.
	SEASON_END: 'season_end',
} as const

export type NotificationKindName =
	(typeof NotificationKind)[keyof typeof NotificationKind]

export interface SeasonEndBoard {
	// The board's display name, for example "PvP Vanilla".
	name: string
	place: number
	rating: number
}

export interface SeasonEnd {
	season: number
	name: string
	boards: SeasonEndBoard[]
}

export interface NotificationParams {
	result_late: LateResult
	result_ranked: RankedResult
	season_end: SeasonEnd
}

export interface StoredNotification {
	id: string
	kind: NotificationKindName
	params: { [key: string]: unknown }
	sentAt: number
}
