// The avatar reset: every player's joker goes back to the default unless
// they may still pick it (a default, a privilege joker or an avatar they have
// earned). Achievement progress is never touched, so the reset cannot undo
// what games or the backfill (backfill.ts) earned, whichever runs first.
// Paged, so the API calls it until the cursor is ''. dryRun counts without
// changing anything.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import {
	PLAYER_COLLECTION,
	PROFILE_KEY,
	profileOf,
	updateProfile,
} from '../player/profile'
import { profileChanged } from '../player/rpc'
import { listCollectionPage, parsePayload, requireServer } from '../rpc'
import { DEFAULT_AVATAR } from '../shared/avatars/ids'
import { isSelectable } from '../shared/avatars/unlocked'
import { progressFor } from './storage'

const PAGE = 100

// Whether the joker survives the reset: one the player may pick.
export function keepsJoker(
	joker: string,
	privileges: readonly string[],
	unlocked: readonly string[],
): boolean {
	return isSelectable(joker, { privileges, unlocked })
}

// {cursor?, dryRun?} -> {dryRun, checked, jokersReset, cursor}
export function rpcAdminAvatarsReset(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	if (input.cursor !== undefined && typeof input.cursor !== 'string')
		throw runtimeError(INVALID_ARGUMENT, 'Invalid cursor')
	if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean')
		throw runtimeError(INVALID_ARGUMENT, 'dryRun must be a boolean')
	const dryRun = input.dryRun === true
	let checked = 0
	let jokersReset = 0

	const page = listCollectionPage(
		nk,
		PLAYER_COLLECTION,
		PAGE,
		(input.cursor as string | undefined) || '',
	)
	for (const object of page.objects || []) {
		if (object.key !== PROFILE_KEY) continue
		checked++
		const stored = profileOf(object.value, '')
		const unlocked = progressFor(nk, object.userId).unlocked
		if (keepsJoker(stored.preferredJoker, stored.privileges, unlocked)) continue
		jokersReset++
		if (dryRun) continue
		const profile = updateProfile(nk, object.userId, (current) =>
			keepsJoker(current.preferredJoker, current.privileges, unlocked)
				? current
				: { ...current, preferredJoker: DEFAULT_AVATAR },
		)
		profileChanged(nk, logger, object.userId, profile)
	}
	logger.info(
		'Avatar reset%s: %d checked, %d jokers reset',
		dryRun ? ' (dry run)' : '',
		checked,
		jokersReset,
	)
	return JSON.stringify({
		dryRun,
		checked,
		jokersReset,
		cursor: page.cursor || '',
	})
}
