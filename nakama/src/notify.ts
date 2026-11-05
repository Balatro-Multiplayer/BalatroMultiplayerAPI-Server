import { SYSTEM_USER_ID } from './lobby/protocol'

// Pushes to a player's socket, as Nakama notifications. The client routes
// them by code (MPAPI networking/nakama_notify.lua); keep both lists in step.
export const NotifyCode = {
	CHALLENGE: 100,
	ACCOUNT_UPDATED: 101,
	BANNED: 102,
	QUEUE_CANCELLED: 103,
	// 104 and 106 are retired (never sent); don't reuse them.
	INTEGRITY: 105,
	// {avatarIds, runId}: avatars just earned (runId null for one earned
	// outside a game). Persistent, so an offline player sees it at login.
	AVATAR_UNLOCKED: 107,
	// {standing, disallowed, reason} (standing/rpc.ts): the mod allowlist
	// changed, so the player's standing may have.
	STANDING_CHANGED: 108,
	// {message, itemType, warnedAt}: a moderator's warning (service queue).
	// Persistent, so an offline player sees it at their next login.
	WARNED: 109,
	// 110 and 111 (late and ranked results) are retired: those results are
	// Notifications now (112); don't reuse them.
	// {id, kind, params, sentAt}: a stored Notification (notification/store.ts).
	// The live push of one that also waits unread in the store; the client
	// marks it read once shown.
	NOTIFICATION: 112,
}

const CODES: number[] = Object.keys(NotifyCode).map((k) => (NotifyCode as { [k: string]: number })[k])

export function isNotifyCode(code: unknown): code is number {
	return typeof code === 'number' && CODES.indexOf(code) !== -1
}

// Nakama 3.41 refuses '' as a sender ("expects senderId to either be not
// set, empty string or a valid UUID", despite the message): server pushes
// come from the system user.
// Persistent notifications are also kept for players who are offline and
// listed for them at their next login; transient ones only reach live sockets.
export function notify(
	nk: nkruntime.Nakama,
	userId: string,
	code: number,
	subject: string,
	content: { [key: string]: unknown },
	persistent = false,
) {
	nk.notificationSend(userId, subject, content, code, SYSTEM_USER_ID, persistent)
}
