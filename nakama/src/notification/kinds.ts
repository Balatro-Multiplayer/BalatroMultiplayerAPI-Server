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
	// A moderator decided a contested match.
	CONTEST_DECIDED: 'contest_decided',
	// Staff voided a match.
	RESULT_VOIDED: 'result_voided',
	// Staff set a match's result.
	RESULT_CHANGED: 'result_changed',
	// Staff punished a player the recipient reported.
	REPORT_ACTION: 'report_action',
	// A season ended: the player's place and rating on each board they are on.
	SEASON_END: 'season_end',
	// An appeal was decided.
	APPEAL_DECIDED: 'appeal_decided',
	// A chat, queue or account ban ended, by time or lifted early.
	PUNISHMENT_ENDED: 'punishment_ended',
} as const

export type NotificationKindName =
	(typeof NotificationKind)[keyof typeof NotificationKind]

// What a staff decision means for one player. A draw is every player on the
// same place; a win is the best place without that tie.
export type ResultOutcome = 'win' | 'draw' | 'loss'

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

export type BanKindName = 'chat' | 'queue' | 'account'

// What an appeal was about: a ban, a warning, or the network ban that blocks
// the player.
export type AppealTarget = BanKindName | 'warning' | 'network'

export interface AppealDecided {
	accepted: boolean
	target: AppealTarget
	// What an accepted appeal did to the punishment; null when declined.
	result: 'lifted' | 'shortened' | null
}

export interface PunishmentEnded {
	ban: BanKindName
}

export interface NotificationParams {
	result_late: LateResult
	result_ranked: RankedResult
	// `contester` is the player who contested; the others are told of it.
	contest_decided: {
		role: 'contester' | 'opponent'
		outcome: ResultOutcome
	}
	result_voided: { [key: string]: never }
	result_changed: { outcome: ResultOutcome }
	report_action: { [key: string]: never }
	season_end: SeasonEnd
	appeal_decided: AppealDecided
	punishment_ended: PunishmentEnded
}

export interface StoredNotification {
	id: string
	kind: NotificationKindName
	params: { [key: string]: unknown }
	sentAt: number
}
