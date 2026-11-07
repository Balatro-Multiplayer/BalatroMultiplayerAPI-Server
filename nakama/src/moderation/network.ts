// Network bans (ADR 0005). Only the Official server has them.
//
// Each Steam login stores a salted hash (IP_HASH_SALT) of the player's
// network with the time of the last login from it; a hash goes 30 days after
// that time. A permanent account ban copies the account's hashes into a
// network ban, which refuses every login (and session refresh) from them
// until an admin lifts it. A lifted network ban stays as a record without
// hashes, so the same account ban applied again does not bring it back.
import { SYSTEM_USER_ID } from '../lobby/protocol'
import type { ServerSettings } from '../server_kind'
import { forEachStored } from '../shared/storage'
import { DAY_MS } from '../shared/time'
import type { Ban } from './bans'

export const IP_HASHES_COLLECTION = 'ip_hashes'
export const IP_HASHES_KEY = 'networks'
export const NETWORK_BANS_COLLECTION = 'network_bans'
export const NETWORK_BAN_INDEX_COLLECTION = 'network_ban_index'
export const IP_HASH_DAYS = 30

// hash -> epoch ms of the last login from that network.
export type IpHashes = { [hash: string]: number }

export interface NetworkBan {
	banId: string
	// The permanently banned account it came from.
	userId: string
	hashes: string[]
	bannedAt: number
	liftedAt: number | null
}

// What an admin sees: never the hashes.
export interface NetworkBanView {
	banId: string
	userId: string
	networks: number
	bannedAt: number
	liftedAt: number | null
}

interface IndexEntry {
	banIds: string[]
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HEX_GROUP = /^[0-9a-f]{1,4}$/

function ipv4(text: string): string | null {
	const m = IPV4.exec(text)
	if (!m) return null
	for (let i = 1; i <= 4; i++) if (Number(m[i]) > 255) return null
	return [m[1], m[2], m[3], m[4]].map(Number).join('.')
}

// The 8 groups of an IPv6 address as numbers, or null. An IPv4 tail (as in
// ::ffff:192.0.2.1) counts as the last 2 groups.
function ipv6Groups(text: string): number[] | null {
	let head = text.toLowerCase()
	const tail: number[] = []
	const lastColon = head.lastIndexOf(':')
	const v4 = ipv4(head.slice(lastColon + 1))
	if (v4 !== null) {
		const parts = v4.split('.').map(Number)
		tail.push(parts[0] * 256 + parts[1], parts[2] * 256 + parts[3])
		// Keep a '::' that ends right before the IPv4 tail; drop a lone ':'.
		head = head.slice(0, lastColon + 1)
		if (!head.endsWith('::')) head = head.slice(0, -1)
	}
	const halves = head.split('::')
	if (halves.length > 2) return null
	const parse = (part: string): number[] | null => {
		if (part === '') return []
		const groups = part.split(':')
		for (const g of groups) if (!HEX_GROUP.test(g)) return null
		return groups.map((g) => Number.parseInt(g, 16))
	}
	const left = parse(halves[0])
	const right = halves.length === 2 ? parse(halves[1]) : []
	if (!left || !right) return null
	const given = left.length + right.length + tail.length
	if (halves.length === 1) return given === 8 ? left.concat(tail) : null
	if (given > 7) return null
	const zeros: number[] = []
	for (let i = given; i < 8; i++) zeros.push(0)
	return left.concat(zeros, right, tail)
}

function isIpv4Mapped(groups: number[]): boolean {
	for (let i = 0; i < 5; i++) if (groups[i] !== 0) return false
	return groups[5] === 0xffff
}

// The network an address belongs to, as networks are banned: the whole
// address for IPv4, the /64 prefix for IPv6 (one home or phone usually gets
// a whole /64). A port and an IPv6 zone are dropped. Null for anything that
// is not an IP address.
export function networkOf(ip: string): string | null {
	let text = ip.trim()
	const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text)
	if (bracketed) text = bracketed[1]
	else if (/^[\d.]+:\d+$/.test(text)) text = text.slice(0, text.indexOf(':'))
	const zone = text.indexOf('%')
	if (zone !== -1) text = text.slice(0, zone)
	if (text.indexOf(':') === -1) return ipv4(text)
	const groups = ipv6Groups(text)
	if (!groups) return null
	if (isIpv4Mapped(groups))
		return [
			groups[6] >> 8,
			groups[6] & 255,
			groups[7] >> 8,
			groups[7] & 255,
		].join('.')
	return `${groups
		.slice(0, 4)
		.map((g) => g.toString(16))
		.join(':')}::/64`
}

// The salted hash of ip's network, or null when ip is not an address.
export function networkHash(
	sha256: (input: string) => string,
	salt: string,
	ip: string,
): string | null {
	const network = networkOf(ip)
	return network === null ? null : sha256(`${salt}:${network}`)
}

// hashes without the ones last seen IP_HASH_DAYS or more before now. Returns
// the same object when none went.
export function withoutStale(hashes: IpHashes, now: number): IpHashes {
	const cutoff = now - IP_HASH_DAYS * DAY_MS
	let changed = false
	const next: IpHashes = {}
	for (const hash of Object.keys(hashes)) {
		if (hashes[hash] > cutoff) next[hash] = hashes[hash]
		else changed = true
	}
	return changed ? next : hashes
}

export function viewOf(ban: NetworkBan): NetworkBanView {
	return {
		banId: ban.banId,
		userId: ban.userId,
		networks: ban.hashes.length,
		bannedAt: ban.bannedAt,
		liftedAt: ban.liftedAt,
	}
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const SERVER_ONLY = { permissionRead: 0, permissionWrite: 0 } as const

export function readIpHashes(nk: nkruntime.Nakama, userId: string): IpHashes {
	const objects = nk.storageRead([
		{ collection: IP_HASHES_COLLECTION, key: IP_HASHES_KEY, userId },
	])
	return objects.length === 0 ? {} : (objects[0].value as IpHashes)
}

function writeIpHashes(nk: nkruntime.Nakama, userId: string, hashes: IpHashes) {
	if (Object.keys(hashes).length === 0) {
		nk.storageDelete([
			{ collection: IP_HASHES_COLLECTION, key: IP_HASHES_KEY, userId },
		])
		return
	}
	nk.storageWrite([
		{
			collection: IP_HASHES_COLLECTION,
			key: IP_HASHES_KEY,
			userId,
			value: hashes as unknown as { [key: string]: unknown },
			...SERVER_ONLY,
		},
	])
}

function readNetworkBan(
	nk: nkruntime.Nakama,
	banId: string,
): NetworkBan | null {
	const objects = nk.storageRead([
		{ collection: NETWORK_BANS_COLLECTION, key: banId, userId: SYSTEM_USER_ID },
	])
	return objects.length === 0
		? null
		: (objects[0].value as unknown as NetworkBan)
}

function writeNetworkBan(nk: nkruntime.Nakama, ban: NetworkBan) {
	nk.storageWrite([
		{
			collection: NETWORK_BANS_COLLECTION,
			key: ban.banId,
			userId: SYSTEM_USER_ID,
			value: ban as unknown as { [key: string]: unknown },
			...SERVER_ONLY,
		},
	])
}

function readIndex(nk: nkruntime.Nakama, hash: string): string[] {
	const objects = nk.storageRead([
		{
			collection: NETWORK_BAN_INDEX_COLLECTION,
			key: hash,
			userId: SYSTEM_USER_ID,
		},
	])
	return objects.length === 0
		? []
		: (objects[0].value as unknown as IndexEntry).banIds || []
}

function writeIndex(nk: nkruntime.Nakama, hash: string, banIds: string[]) {
	if (banIds.length === 0) {
		nk.storageDelete([
			{
				collection: NETWORK_BAN_INDEX_COLLECTION,
				key: hash,
				userId: SYSTEM_USER_ID,
			},
		])
		return
	}
	const value: IndexEntry = { banIds }
	nk.storageWrite([
		{
			collection: NETWORK_BAN_INDEX_COLLECTION,
			key: hash,
			userId: SYSTEM_USER_ID,
			value: value as unknown as { [key: string]: unknown },
			...SERVER_ONLY,
		},
	])
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

// The hash of the calling client's network, or null when this server has no
// network bans or the IP is unusable.
export function clientNetworkHash(
	ctx: nkruntime.Context,
	nk: nkruntime.Nakama,
	settings: ServerSettings,
): string | null {
	const salt = ctx.env.IP_HASH_SALT
	if (!settings.networkBans || !salt || !ctx.clientIp) return null
	return networkHash((input) => nk.sha256Hash(input), salt, ctx.clientIp)
}

// Remembers that userId logged in from this network now.
export function recordNetworkLogin(
	nk: nkruntime.Nakama,
	userId: string,
	hash: string,
	now: number,
) {
	const hashes = { ...withoutStale(readIpHashes(nk, userId), now) }
	hashes[hash] = now
	writeIpHashes(nk, userId, hashes)
}

export function isNetworkBanned(nk: nkruntime.Nakama, hash: string): boolean {
	return readIndex(nk, hash).length > 0
}

// The network bans in force on a network: what an admin lifts to unblock it.
export function networkBanIdsOn(nk: nkruntime.Nakama, hash: string): string[] {
	return readIndex(nk, hash)
}

// For a permanent account ban: bans the networks userId used in the last
// IP_HASH_DAYS. Does nothing for a timed ban, on a server without network
// bans, or when a network ban for this ban already exists (even a lifted
// one). Returns whether it banned anything new.
export function banNetworks(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	userId: string,
	ban: Ban,
	now: number,
): boolean {
	if (!settings.networkBans || ban.expiresAt !== null) return false
	if (readNetworkBan(nk, ban.banId)) return false
	const hashes = Object.keys(withoutStale(readIpHashes(nk, userId), now))
	writeNetworkBan(nk, {
		banId: ban.banId,
		userId,
		hashes,
		bannedAt: now,
		liftedAt: null,
	})
	for (const hash of hashes) {
		const banIds = readIndex(nk, hash)
		if (banIds.indexOf(ban.banId) === -1)
			writeIndex(nk, hash, banIds.concat([ban.banId]))
	}
	return true
}

// Lifts a network ban: its networks are no longer refused (unless another
// network ban covers them) and its hashes are deleted. False when there is
// no such ban in force.
export function liftNetworkBan(
	nk: nkruntime.Nakama,
	banId: string,
	now: number,
): boolean {
	const ban = readNetworkBan(nk, banId)
	if (!ban || ban.liftedAt !== null) return false
	for (const hash of ban.hashes)
		writeIndex(
			nk,
			hash,
			readIndex(nk, hash).filter((id) => id !== banId),
		)
	writeNetworkBan(nk, { ...ban, hashes: [], liftedAt: now })
	return true
}

function listNetworkBans(nk: nkruntime.Nakama): NetworkBan[] {
	const bans: NetworkBan[] = []
	forEachStored(nk, SYSTEM_USER_ID, NETWORK_BANS_COLLECTION, (o) => {
		bans.push(o.value as unknown as NetworkBan)
	})
	return bans
}

// The network bans an admin looking at userId needs: the ones userId's own
// ban caused, and the ones that cover a network userId logged in from.
export function networkBansFor(
	nk: nkruntime.Nakama,
	userId: string,
): NetworkBanView[] {
	const own = readIpHashes(nk, userId)
	return listNetworkBans(nk)
		.filter(
			(ban) => ban.userId === userId || ban.hashes.some((hash) => hash in own),
		)
		.map(viewOf)
}

// Deletes login hashes last seen IP_HASH_DAYS or more before now, across
// every account, looking at up to `max` accounts. Returns how many hashes
// went; `more` means there may be accounts left to look at.
export function purgeIpHashes(
	nk: nkruntime.Nakama,
	now: number,
	max: number,
): { deleted: number; more: boolean } {
	let deleted = 0
	let seen = 0
	const more = forEachStored(nk, null, IP_HASHES_COLLECTION, (o) => {
		if (seen >= max) return 'stop'
		seen++
		const before = o.value as IpHashes
		const after = withoutStale(before, now)
		if (after === before) return
		deleted += Object.keys(before).length - Object.keys(after).length
		writeIpHashes(nk, o.userId, after)
	})
	return { deleted, more }
}

// For InitModule: a server with network bans refuses to start without
// IP_HASH_SALT, rather than silently recording and refusing nothing. The salt
// never changes: a new one would orphan every stored hash.
export function requireIpHashSalt(
	settings: ServerSettings,
	env: { [key: string]: string },
) {
	if (settings.networkBans && !env.IP_HASH_SALT)
		throw new Error('IP_HASH_SALT must be set on the Official server')
}
