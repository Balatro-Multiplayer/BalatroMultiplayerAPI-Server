// Discord linking. The OAuth round trip stays on the API (it holds the
// Discord client secret): discord_link_start asks it for the authorize URL,
// whose state names this Nakama user, and once Discord sends the player back
// the API calls admin_discord_set. One Discord account links to one player:
// discord_index (system-owned, keyed by the Discord id hash) is written
// create-only.
import { recordMilestone } from '../achievements/record'
import { ALREADY_EXISTS, INVALID_ARGUMENT, UNAVAILABLE, runtimeError } from '../errors'
import { callExpress } from '../express'
import { SYSTEM_USER_ID } from '../lobby/protocol'
import { parsePayload, requireServer, requireUser } from '../rpc'
import { playerView, updateProfile, type Profile } from './profile'
import { profileChanged } from './rpc'

export const DISCORD_INDEX_COLLECTION = 'discord_index'
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[A-Za-z0-9_-]{8,128}$/
const MAX_NAME = 64

function indexKey(hash: string) {
	return { collection: DISCORD_INDEX_COLLECTION, key: hash, userId: SYSTEM_USER_ID }
}

// The player whose account a Discord id hash is linked to, if any.
export function discordOwner(nk: nkruntime.Nakama, hash: string): string | null {
	const objects = nk.storageRead([indexKey(hash)])
	return objects.length > 0 ? String(objects[0].value.userId) : null
}

// Claims hash for userId; ALREADY_EXISTS when another player holds it.
export function claimDiscord(nk: nkruntime.Nakama, userId: string, hash: string) {
	const owner = discordOwner(nk, hash)
	if (owner === userId) return
	if (owner !== null) throw runtimeError(ALREADY_EXISTS, 'Discord account already linked to another player')
	try {
		nk.storageWrite([{ ...indexKey(hash), value: { userId }, version: '*', permissionRead: 0, permissionWrite: 0 }])
	} catch (e) {
		throw runtimeError(ALREADY_EXISTS, 'Discord account already linked to another player')
	}
}

export function releaseDiscord(nk: nkruntime.Nakama, userId: string, hash: string | null) {
	if (hash && discordOwner(nk, hash) === userId) nk.storageDelete([indexKey(hash)])
}

// Pure: the profile with Discord linked (or relinked to another account).
export function withDiscord(profile: Profile, hash: string, username: string | null): Profile {
	return { ...profile, discordIdHash: hash, discordUsername: username }
}

// Pure: the profile with Discord unlinked, back on the Steam name.
export function withoutDiscord(profile: Profile): Profile {
	return { ...profile, discordIdHash: null, discordUsername: null, useDiscordName: false }
}

// {} -> {url}: where to send the player to link their Discord.
export function rpcDiscordLinkStart(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const reply = callExpress(nk, logger, ctx.env, '/discord/link-url', { nakamaUserId: userId })
	const url = reply && reply.status === 200 ? reply.body.url : null
	if (typeof url !== 'string') throw runtimeError(UNAVAILABLE, 'Discord linking is unavailable right now')
	return JSON.stringify({ url })
}

// {} -> {player}. The API's row follows (best effort).
export function rpcDiscordUnlink(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	let previous: string | null = null
	const profile = updateProfile(
		nk,
		userId,
		(current) => {
			previous = current.discordIdHash
			return withoutDiscord(current)
		},
		ctx.username,
	)
	releaseDiscord(nk, userId, previous)
	profileChanged(nk, logger, userId, profile)
	callExpress(nk, logger, ctx.env, '/discord/unlinked', { nakamaUserId: userId })
	return JSON.stringify({ player: playerView(nk, userId, profile) })
}

// Server only. {userId, discordIdHash, discordUsername?} -> {player}, or
// ALREADY_EXISTS when that Discord account is another player's.
export function rpcAdminDiscordSet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const { userId, discordIdHash, discordUsername } = parsePayload(payload)
	if (typeof userId !== 'string' || !USER_ID.test(userId)) throw runtimeError(INVALID_ARGUMENT, 'Missing or invalid userId')
	if (typeof discordIdHash !== 'string' || !HASH.test(discordIdHash))
		throw runtimeError(INVALID_ARGUMENT, 'Missing or invalid discordIdHash')
	const name = typeof discordUsername === 'string' && discordUsername ? discordUsername.slice(0, MAX_NAME) : null
	nk.accountGetId(userId) // throws for an unknown player, before the claim
	claimDiscord(nk, userId, discordIdHash)
	let previous: string | null = null
	const profile = updateProfile(nk, userId, (current) => {
		previous = current.discordIdHash
		return withDiscord(current, discordIdHash, name)
	})
	if (previous !== discordIdHash) releaseDiscord(nk, userId, previous)
	profileChanged(nk, logger, userId, profile)
	recordMilestone(nk, logger, userId, 'discordLinked', profile.privileges)
	logger.info('Linked Discord to %s', userId)
	return JSON.stringify({ player: playerView(nk, userId, profile) })
}
