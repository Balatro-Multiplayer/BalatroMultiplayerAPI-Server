// Putting bans into force. The API issues and lifts them (admin_ban_apply /
// admin_ban_lift) and Postgres keeps their history; here a ban reaches the
// player at once:
// - account: Nakama's own ban (usersBanId: sessions dropped, logins and
//   refreshes refused), the player taken out of their lobby, BANNED pushed.
// - queue: out of a started game (an instant forfeit, as the API's
//   forfeitMatchForBan), and refused at MatchmakerAdd.
// - chat: refused at chat_send.
// - username: the player shows as their Ban name everywhere (username_ban.ts);
//   nothing is refused.
//
// usersBanId has no expiry, so a temporary account ban is lifted lazily: the
// login before-hooks look the account up in ban_index (Steam id or device id
// -> ban) and unban an expired one before Nakama's own check runs.
//
// A deleted account's entries name its anonymous id, which has no account.
// They stay only when the player has a ban record (player/anonymize.ts), and
// then exactly as long as Postgres keeps the Steam id hash: while a ban is in
// force they refuse a new account on the same login id, and 12 months after
// deletion with no ban in force the API's hourly job has them forgotten
// (forgetBanIndex). A login on that id after the ban runs out drops them
// too: the API then gives the deleted account's row back (the restore).
import { runtimeError, PERMISSION_DENIED } from '../errors'
import { currentLobby } from '../lobby/rpc'
import { SYSTEM_USER_ID, type LobbySignal } from '../lobby/protocol'
import { banNameOf } from '../../../packages/types/src/ban-name'
import { notify, NotifyCode } from '../notify'
import { NotificationKind } from '../notification/kinds'
import { sendNotification } from '../notification/store'
import { forEachStored } from '../shared/storage'
import { STEAM_HASH_CUSTOM_ID_PREFIX } from '../player/steam_id'
import { ACCOUNT_BANNED, banMessage } from './access'
import { showNameChange } from './username_ban'
import {
	activeBan,
	readBans,
	withBan,
	withoutBan,
	withoutExpired,
	writeBans,
	type Ban,
	type BanType,
	type Bans,
} from './bans'

export const BAN_INDEX_COLLECTION = 'ban_index'
// A ban index key for a custom id login (the API's Steam id rewrite builds
// the same keys).
export const BAN_INDEX_CUSTOM_PREFIX = 'custom:'

interface IndexEntry {
	userId: string
	ban: Ban
}

// The login ids that lead to userId's account: its Steam custom id and any
// device ids, as the before-hooks see them.
export function loginKeys(nk: nkruntime.Nakama, userId: string): string[] {
	const account = nk.accountGetId(userId)
	const keys: string[] = []
	if (account.customId) keys.push(BAN_INDEX_CUSTOM_PREFIX + account.customId)
	for (const device of account.devices || []) keys.push('device:' + device.id)
	return keys
}

function writeIndex(nk: nkruntime.Nakama, userId: string, ban: Ban) {
	const value: IndexEntry = { userId, ban }
	nk.storageWrite(
		loginKeys(nk, userId).map((key) => ({
			collection: BAN_INDEX_COLLECTION,
			key,
			userId: SYSTEM_USER_ID,
			value: value as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
		})),
	)
}

function deleteIndex(nk: nkruntime.Nakama, userId: string) {
	nk.storageDelete(
		loginKeys(nk, userId).map((key) => ({ collection: BAN_INDEX_COLLECTION, key, userId: SYSTEM_USER_ID })),
	)
}

// Takes userId out of their lobby: always for an account ban, only out of a
// running game for a queue ban.
function removeFromLobby(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, reason: string, onlyIfStarted: boolean) {
	const lobby = currentLobby(nk, logger, userId)
	if (!lobby) return
	const signal: LobbySignal = { type: 'admin_remove', userId, reason, onlyIfStarted }
	nk.matchSignal(lobby.matchId, JSON.stringify(signal))
}

function pushBan(nk: nkruntime.Nakama, userId: string, type: BanType, ban: Ban) {
	notify(
		nk,
		userId,
		NotifyCode.BANNED,
		'banned',
		{ banType: type, banId: ban.banId, reason: ban.reason, expiresAt: ban.expiresAt },
		type === 'account',
	)
}

// Account-ban side effects for a ban already in storage.
export function enforceAccountBan(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, ban: Ban) {
	writeIndex(nk, userId, ban)
	removeFromLobby(nk, logger, userId, 'banned', false)
	nk.usersBanId([userId])
}

export function applyBan(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	userId: string,
	type: BanType,
	ban: Ban,
): Bans {
	const before = readBans(nk, userId)
	const bans = withBan(before, type, ban)
	writeBans(nk, userId, bans)
	// A username ban blocks nothing: the player is told by a Notification and
	// sees the Ban name, so no BANNED push (older clients would read it as an
	// account ban).
	if (type === 'username') {
		showNameChange(nk, logger, userId)
		// Once per ban: the API repeats a failed apply.
		if (before.username?.banId !== ban.banId)
			sendNotification(nk, userId, NotificationKind.USERNAME_BANNED, { banName: banNameOf(userId) })
	} else pushBan(nk, userId, type, ban)
	if (type === 'queue') removeFromLobby(nk, logger, userId, 'banned', true)
	if (type === 'account' && bans.account) enforceAccountBan(nk, logger, userId, bans.account)
	logger.info('Applied %s ban %s to %s', type, ban.banId, userId)
	return bans
}

// Lifts Nakama's own ban once no account ban is left.
function releaseAccount(nk: nkruntime.Nakama, userId: string, before: Bans, after: Bans) {
	if (before.account && !after.account) {
		deleteIndex(nk, userId)
		nk.usersUnbanId([userId])
	}
}

export function liftBan(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, banId: string): Bans {
	const before = readBans(nk, userId)
	const after = withoutBan(before, banId)
	writeBans(nk, userId, after)
	releaseAccount(nk, userId, before, after)
	if (before.username && !after.username) showNameChange(nk, logger, userId)
	logger.info('Lifted ban %s of %s', banId, userId)
	return after
}

// Re-keys an account's ban index entry after its login id changed (a Device
// login moving from the raw Steam id to its hash), so the old id is not kept.
export function moveLoginKey(nk: nkruntime.Nakama, from: string, to: string) {
	const [entry] = nk.storageRead([{ collection: BAN_INDEX_COLLECTION, key: from, userId: SYSTEM_USER_ID }])
	if (!entry) return
	nk.storageWrite([
		{
			collection: BAN_INDEX_COLLECTION,
			key: to,
			userId: SYSTEM_USER_ID,
			value: entry.value,
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
	nk.storageDelete([{ collection: BAN_INDEX_COLLECTION, key: from, userId: SYSTEM_USER_ID }])
}

function accountExists(nk: nkruntime.Nakama, userId: string): boolean {
	try {
		nk.accountGetId(userId)
		return true
	} catch {
		return false
	}
}

function deleteIndexKey(nk: nkruntime.Nakama, key: string) {
	nk.storageDelete([{ collection: BAN_INDEX_COLLECTION, key, userId: SYSTEM_USER_ID }])
}

// For the login before-hooks: refuses a login into a banned account, and
// lifts an account ban that has run out. key is a loginKeys entry.
export function checkLoginBan(nk: nkruntime.Nakama, logger: nkruntime.Logger, key: string, now: number) {
	const objects = nk.storageRead([{ collection: BAN_INDEX_COLLECTION, key, userId: SYSTEM_USER_ID }])
	if (objects.length === 0) return
	const entry = objects[0].value as unknown as IndexEntry
	if (activeBan({ account: entry.ban }, 'account', now))
		throw runtimeError(PERMISSION_DENIED, banMessage(ACCOUNT_BANNED, entry.ban))
	if (!accountExists(nk, entry.userId)) {
		deleteIndexKey(nk, key)
		logger.info('Account ban of deleted account %s expired; index entry dropped at a login on its id', entry.userId)
		return
	}
	const before = readBans(nk, entry.userId)
	const after = withoutExpired(before, now)
	if (after !== before) writeBans(nk, entry.userId, after)
	if (activeBan(after, 'account', now)) {
		// A longer ban replaced the indexed one; index it instead.
		writeIndex(nk, entry.userId, after.account as Ban)
		throw runtimeError(PERMISSION_DENIED, banMessage(ACCOUNT_BANNED, after.account as Ban))
	}
	deleteIndex(nk, entry.userId)
	nk.usersUnbanId([entry.userId])
	logger.info('Account ban of %s expired; unbanned', entry.userId)
}

// {deleted}: forgets the ban_index entries of deleted accounts whose Steam id
// hash Postgres no longer keeps (12 months after deletion with no ban in
// force: the API's hourly job, which sends the hashes it cleared). Each hash
// leads to the anonymous id of its entry; every entry of that anonymous id
// goes (its device ids too). A ban still in force, or a live account, is
// never forgotten.
export function forgetBanIndex(
	nk: nkruntime.Nakama,
	steamIdHashes: string[],
	now: number,
): { deleted: number } {
	if (steamIdHashes.length === 0) return { deleted: 0 }
	const forgotten: { [userId: string]: true } = {}
	const entries = nk.storageRead(
		steamIdHashes.map((hash) => ({
			collection: BAN_INDEX_COLLECTION,
			key: BAN_INDEX_CUSTOM_PREFIX + STEAM_HASH_CUSTOM_ID_PREFIX + hash,
			userId: SYSTEM_USER_ID,
		})),
	)
	for (const o of entries) {
		const entry = o.value as unknown as IndexEntry
		if (activeBan({ account: entry.ban }, 'account', now) || accountExists(nk, entry.userId)) continue
		forgotten[entry.userId] = true
	}
	const keys: string[] = []
	forEachStored(nk, SYSTEM_USER_ID, BAN_INDEX_COLLECTION, (o) => {
		if (forgotten[(o.value as unknown as IndexEntry).userId]) keys.push(o.key)
	})
	for (const key of keys) deleteIndexKey(nk, key)
	return { deleted: keys.length }
}
