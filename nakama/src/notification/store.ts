// The Notification store: what happened to a player while they may have been
// away. Each one is a system-written storage object owned by the player. It
// waits until the client reads it (shown once), and is dropped unread after
// 30 days. An online player also gets it as a live push, which carries the
// same id so the client can mark it read once shown.
import { NotifyCode, notify } from '../notify'
import type {
	NotificationKindName,
	NotificationParams,
	StoredNotification,
} from './kinds'

export const NOTIFICATIONS_COLLECTION = 'notifications'
export const NOTIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000
// Per player. Sending past it drops the oldest, so a player who never returns
// does not grow without bound.
export const MAX_STORED_NOTIFICATIONS = 100

export function isExpired(
	notification: StoredNotification,
	now: number,
): boolean {
	return now - notification.sentAt >= NOTIFICATION_TTL_MS
}

function isStored(value: { [key: string]: unknown }): boolean {
	return (
		typeof value.id === 'string' &&
		typeof value.kind === 'string' &&
		typeof value.sentAt === 'number'
	)
}

function readAll(nk: nkruntime.Nakama, userId: string): StoredNotification[] {
	const page = nk.storageList(
		userId,
		NOTIFICATIONS_COLLECTION,
		MAX_STORED_NOTIFICATIONS + 1,
		'',
	)
	const found: StoredNotification[] = []
	for (const object of page.objects || []) {
		if (!isStored(object.value)) continue
		found.push({
			id: object.value.id as string,
			kind: object.value.kind as NotificationKindName,
			params: (object.value.params as { [key: string]: unknown }) || {},
			sentAt: object.value.sentAt as number,
		})
	}
	return found.sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : 1))
}

function remove(nk: nkruntime.Nakama, userId: string, ids: string[]) {
	if (ids.length === 0) return
	nk.storageDelete(
		ids.map((id) => ({
			collection: NOTIFICATIONS_COLLECTION,
			key: id,
			userId,
		})),
	)
}

// Stores a Notification for the player and pushes it live. The push is
// transient: an offline player gets it from listNotifications at login.
export function sendNotification<K extends NotificationKindName>(
	nk: nkruntime.Nakama,
	userId: string,
	kind: K,
	params: NotificationParams[K],
	now: number = Date.now(),
): StoredNotification {
	const stored: StoredNotification = {
		id: nk.uuidv4(),
		kind,
		params: { ...params },
		sentAt: now,
	}
	const waiting = readAll(nk, userId)
	const dropped = waiting.filter((n) => isExpired(n, now)).map((n) => n.id)
	const live = waiting.filter((n) => !isExpired(n, now))
	const overflow = live
		.slice(0, Math.max(0, live.length + 1 - MAX_STORED_NOTIFICATIONS))
		.map((n) => n.id)
	remove(nk, userId, dropped.concat(overflow))
	nk.storageWrite([
		{
			collection: NOTIFICATIONS_COLLECTION,
			key: stored.id,
			userId,
			value: { ...stored },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
	notify(nk, userId, NotifyCode.NOTIFICATION, kind, { ...stored }, false)
	return stored
}

// The player's unread Notifications, oldest first. Expired ones are dropped
// here, so a Notification unread for 30 days is never shown.
export function listNotifications(
	nk: nkruntime.Nakama,
	userId: string,
	now: number = Date.now(),
): StoredNotification[] {
	const all = readAll(nk, userId)
	remove(
		nk,
		userId,
		all.filter((n) => isExpired(n, now)).map((n) => n.id),
	)
	return all.filter((n) => !isExpired(n, now))
}

// Marks Notifications read: they are deleted and never listed again.
export function markNotificationsRead(
	nk: nkruntime.Nakama,
	userId: string,
	ids: string[],
) {
	remove(nk, userId, ids)
}
