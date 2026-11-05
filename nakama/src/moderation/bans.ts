// A player's active bans, as the BMP API (Express) issues them. Postgres
// keeps the history; Nakama keeps what is in force now, in one object per
// player owned by that player but readable and writable only by the server.
export const MODERATION_COLLECTION = 'moderation'
export const BANS_KEY = 'bans'

export const BAN_TYPES = ['chat', 'queue', 'account', 'username'] as const
export type BanType = (typeof BAN_TYPES)[number]

export interface Ban {
	banId: string
	// Epoch ms, or null for a permanent ban.
	expiresAt: number | null
	reason: string
}

export type Bans = { [T in BanType]?: Ban }

export function isBanType(value: unknown): value is BanType {
	return typeof value === 'string' && (BAN_TYPES as readonly string[]).indexOf(value) !== -1
}

export function isBan(value: unknown): value is Ban {
	const b = value as Ban
	return (
		typeof b === 'object' &&
		b !== null &&
		typeof b.banId === 'string' &&
		typeof b.reason === 'string' &&
		(b.expiresAt === null || (typeof b.expiresAt === 'number' && Number.isFinite(b.expiresAt)))
	)
}

// The ban of that type still in force at `now`, or null.
export function activeBan(bans: Bans, type: BanType, now: number): Ban | null {
	const ban = bans[type]
	if (!ban) return null
	return ban.expiresAt === null || ban.expiresAt > now ? ban : null
}

// The ban that lasts longer: a permanent one, else the later expiry.
function longer(a: Ban | undefined, b: Ban): Ban {
	if (!a) return b
	if (a.expiresAt === null) return a
	if (b.expiresAt === null) return b
	return b.expiresAt > a.expiresAt ? b : a
}

// Several bans of a type can be active at once in Postgres; Nakama keeps the
// one that lasts longest.
export function withBan(bans: Bans, type: BanType, ban: Ban): Bans {
	return { ...bans, [type]: longer(bans[type], ban) }
}

// bans with the given ban (by id) gone.
export function withoutBan(bans: Bans, banId: string): Bans {
	const next: Bans = {}
	for (const type of BAN_TYPES) {
		const ban = bans[type]
		if (ban && ban.banId !== banId) next[type] = ban
	}
	return next
}

// Drops every expired ban. Returns the same object when nothing expired.
export function withoutExpired(bans: Bans, now: number): Bans {
	let changed = false
	const next: Bans = {}
	for (const type of BAN_TYPES) {
		const ban = bans[type]
		if (!ban) continue
		if (activeBan(bans, type, now)) next[type] = ban
		else changed = true
	}
	return changed ? next : bans
}

export function bansFromList(list: { type: unknown; banId: unknown; expiresAt: unknown; reason: unknown }[]): Bans {
	let bans: Bans = {}
	for (const entry of list) {
		const ban = { banId: entry.banId, expiresAt: entry.expiresAt, reason: entry.reason }
		if (isBanType(entry.type) && isBan(ban)) bans = withBan(bans, entry.type, ban)
	}
	return bans
}

export function readBans(nk: nkruntime.Nakama, userId: string): Bans {
	const objects = nk.storageRead([{ collection: MODERATION_COLLECTION, key: BANS_KEY, userId }])
	if (objects.length === 0) return {}
	const stored = objects[0].value as { [key: string]: unknown }
	const bans: Bans = {}
	for (const type of BAN_TYPES) if (isBan(stored[type])) bans[type] = stored[type] as Ban
	return bans
}

export function writeBans(nk: nkruntime.Nakama, userId: string, bans: Bans) {
	nk.storageWrite([
		{
			collection: MODERATION_COLLECTION,
			key: BANS_KEY,
			userId,
			value: bans as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
}
