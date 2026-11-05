// A player's account data that lives on Nakama: what the BMP API kept in its
// players row and in-memory session (names, joker, Discord, ToS, chat flags,
// privileges, mutes). Owned by the player, readable by them, written only by
// the server. Brought over from Postgres once, at the first session_init
// (player/session.ts).
import { banNameOf } from '../../../packages/types/src/ban-name'
import { activeBan, readBans } from '../moderation/bans'
import { DEFAULT_AVATAR } from '../shared/avatars/ids'
import { privilegeTable, selectableOrDefault } from '../shared/avatars/unlocked'

export const PLAYER_COLLECTION = 'player'
export const PROFILE_KEY = 'profile'

const MAX_NAME_LENGTH = 64
const WRITE_ATTEMPTS = 3

export interface Profile {
	steamName: string
	useDiscordName: boolean
	preferredJoker: string
	// The player's installed mods, as the client last reported them.
	mods: unknown
	discordIdHash: string | null
	discordUsername: string | null
	privileges: string[]
	tosAcceptedVersion: number
	// When the player accepted that Notice version (ms), or null.
	noticeAcceptedAt: number | null
	// True once the player answered the age question (it sets chatEnabled or
	// chatBlocked). Asked once, on every server kind.
	ageAnswered: boolean
	chatEnabled: boolean
	chatBlocked: boolean
	mutedUserIds: string[]
	// Legacy (Postgres) player ids muted before the muted player had a Nakama
	// account; resolved into mutedUserIds once they log in to Nakama.
	unresolvedMutedPlayerIds: string[]
	// The players row this account was synced from, if any.
	legacyPlayerId: string | null
	// True once the Postgres sync ran (or there was nothing to sync).
	synced: boolean
	// True once the player has logged in through session_init. Until then
	// the profile only holds what Nakama's own checks need (ToS, chat
	// consent), and the names still come from the Postgres sync.
	nakamaLogin: boolean
}

// What the API's player-sync route answers (apps/server/src/features/nakama/player-sync.service.ts).
export interface PlayerSync {
	playerId: string
	steamName: string
	useDiscordName: boolean
	preferredJoker: string
	discordIdHash: string | null
	discordUsername: string | null
	privileges: string[]
	tosAcceptedVersion: number
	noticeAcceptedAt?: number | null
	chatEnabled: boolean
	chatBlocked: boolean
	mutedUserIds: string[]
	unresolvedMutedPlayerIds: string[]
	bans: { type: unknown; banId: unknown; expiresAt: unknown; reason: unknown }[]
}

export function cleanName(name: unknown): string {
	if (typeof name !== 'string') return ''
	return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH)
}

export function defaultProfile(steamName: string): Profile {
	return {
		steamName,
		useDiscordName: false,
		preferredJoker: DEFAULT_AVATAR,
		mods: null,
		discordIdHash: null,
		discordUsername: null,
		privileges: [],
		tosAcceptedVersion: 0,
		noticeAcceptedAt: null,
		ageAnswered: false,
		chatEnabled: false,
		chatBlocked: false,
		mutedUserIds: [],
		unresolvedMutedPlayerIds: [],
		legacyPlayerId: null,
		synced: false,
		nakamaLogin: false,
	}
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// Data without ageAnswered (an older profile, or the Postgres sync): the
// first Notice acceptance asked the age, and only the age answer sets chat
// on or blocks it.
function ageAnsweredBefore(value: { [key: string]: unknown }): boolean {
	return (
		(typeof value.tosAcceptedVersion === 'number' && value.tosAcceptedVersion > 0) ||
		value.chatEnabled === true ||
		value.chatBlocked === true
	)
}

// The stored object as a Profile, filling in anything missing (older shapes).
export function profileOf(value: { [key: string]: unknown }, fallbackName: string): Profile {
	const base = defaultProfile(cleanName(value.steamName) || fallbackName)
	return {
		...base,
		useDiscordName: value.useDiscordName === true,
		preferredJoker: typeof value.preferredJoker === 'string' ? value.preferredJoker : base.preferredJoker,
		mods: value.mods === undefined ? null : value.mods,
		discordIdHash: typeof value.discordIdHash === 'string' ? value.discordIdHash : null,
		discordUsername: typeof value.discordUsername === 'string' ? value.discordUsername : null,
		privileges: stringList(value.privileges),
		tosAcceptedVersion: typeof value.tosAcceptedVersion === 'number' ? value.tosAcceptedVersion : 0,
		noticeAcceptedAt: typeof value.noticeAcceptedAt === 'number' ? value.noticeAcceptedAt : null,
		ageAnswered: typeof value.ageAnswered === 'boolean' ? value.ageAnswered : ageAnsweredBefore(value),
		chatEnabled: value.chatEnabled === true,
		chatBlocked: value.chatBlocked === true,
		mutedUserIds: stringList(value.mutedUserIds),
		unresolvedMutedPlayerIds: stringList(value.unresolvedMutedPlayerIds),
		legacyPlayerId: typeof value.legacyPlayerId === 'string' ? value.legacyPlayerId : null,
		synced: value.synced === true,
		nakamaLogin: value.nakamaLogin === true,
	}
}

// profile with the player's Postgres data applied. The synced joker is kept
// only if the synced privileges and the earned avatars (unlocked) allow it.
export function withSync(profile: Profile, sync: PlayerSync, unlocked: readonly string[] = []): Profile {
	const privileges = stringList(sync.privileges)
	const joker = typeof sync.preferredJoker === 'string' ? sync.preferredJoker : profile.preferredJoker
	return {
		...profile,
		useDiscordName: sync.useDiscordName === true,
		preferredJoker: selectableOrDefault(joker, { privileges, unlocked }),
		discordIdHash: sync.discordIdHash ?? null,
		discordUsername: sync.discordUsername ?? null,
		privileges,
		tosAcceptedVersion: typeof sync.tosAcceptedVersion === 'number' ? sync.tosAcceptedVersion : 0,
		noticeAcceptedAt: typeof sync.noticeAcceptedAt === 'number' ? sync.noticeAcceptedAt : null,
		ageAnswered: profile.ageAnswered || ageAnsweredBefore(sync as unknown as { [key: string]: unknown }),
		chatEnabled: sync.chatEnabled === true,
		chatBlocked: sync.chatBlocked === true,
		mutedUserIds: stringList(sync.mutedUserIds),
		unresolvedMutedPlayerIds: stringList(sync.unresolvedMutedPlayerIds),
		legacyPlayerId: typeof sync.playerId === 'string' ? sync.playerId : null,
		synced: true,
	}
}

// The name other players see.
export function displayNameOf(profile: Profile): string {
	if (profile.useDiscordName && profile.discordUsername) return profile.discordUsername
	return profile.steamName
}

// The player's Ban name while a username ban is in force, else null.
export function banNameFor(nk: nkruntime.Nakama, userId: string): string | null {
	return activeBan(readBans(nk, userId), 'username', Date.now()) ? banNameOf(userId) : null
}

// The name everyone sees: the Ban name under a username ban (the Steam name
// and the Discord choice have no effect then), else the player's own pick.
export function shownNameOf(nk: nkruntime.Nakama, userId: string, profile: Profile): string {
	return banNameFor(nk, userId) ?? displayNameOf(profile)
}

// The login response's player object, in the API's playerPayload shape.
// usernameBanned lets the client show the Ban name for the Steam and Discord
// names too (it works the name out from the id).
export function playerView(nk: nkruntime.Nakama, userId: string, profile: Profile) {
	return {
		id: userId,
		steamName: profile.steamName,
		displayName: shownNameOf(nk, userId, profile),
		usernameBanned: banNameFor(nk, userId) !== null,
		useDiscordName: profile.useDiscordName,
		preferredJoker: profile.preferredJoker,
		discordLinked: profile.discordIdHash !== null,
		discordUsername: profile.discordUsername,
		privileges: privilegeTable(profile.privileges),
		chatEnabled: profile.chatEnabled,
		chatBlocked: profile.chatBlocked,
		mutedPlayerIds: profile.mutedUserIds,
	}
}

export interface StoredProfile {
	profile: Profile
	version: string
}

export function readProfile(nk: nkruntime.Nakama, userId: string, fallbackName = ''): StoredProfile | null {
	const objects = nk.storageRead([{ collection: PLAYER_COLLECTION, key: PROFILE_KEY, userId }])
	if (objects.length === 0) return null
	return { profile: profileOf(objects[0].value, fallbackName), version: objects[0].version || '' }
}

// Writes profile if it is still at `version` ('*': must not exist yet).
// Throws on a version clash.
export function writeProfile(nk: nkruntime.Nakama, userId: string, profile: Profile, version?: string) {
	nk.storageWrite([
		{
			collection: PLAYER_COLLECTION,
			key: PROFILE_KEY,
			userId,
			value: profile as unknown as { [key: string]: unknown },
			version,
			permissionRead: 1,
			permissionWrite: 0,
		},
	])
}

// Applies change to the stored profile (a default one when there is none),
// retrying on a concurrent write. Returns the written profile.
export function updateProfile(
	nk: nkruntime.Nakama,
	userId: string,
	change: (profile: Profile) => Profile,
	fallbackName = '',
): Profile {
	let lastError: unknown = null
	for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
		const stored = readProfile(nk, userId, fallbackName)
		const next = change(stored ? stored.profile : defaultProfile(fallbackName))
		try {
			writeProfile(nk, userId, next, stored ? stored.version : '*')
			return next
		} catch (e) {
			lastError = e
		}
	}
	throw lastError
}

// The profile, or a default one (not stored) when the player has none yet.
export function profileFor(nk: nkruntime.Nakama, userId: string, fallbackName = ''): Profile {
	const stored = readProfile(nk, userId, fallbackName)
	return stored ? stored.profile : defaultProfile(fallbackName)
}
