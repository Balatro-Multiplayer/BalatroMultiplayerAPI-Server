// Run saves: one player's whole run state at a Blind Select or shop screen, sent by
// the client in parts (mpapi_run_save_part) and kept here for the rest of the
// match. The server holds the latest complete save per player and never
// relays one. Only the owner gets theirs back, with their active run on a
// rejoin (lobby/active.ts). A save does not touch the replay log and is gone
// when the game ends (emptyGame). The part format is mirrored by hand in MPAPI
// (api/replay/run_save.lua).
import type { PendingRunSave, RunSave } from '../lobby/protocol'
import { isParticipant } from '../lobby/state'
import type { AuthoritativeAction } from './registry'

export const RUN_SAVE_PART_KEY = 'mpapi_run_save_part'
// Longest `data` of one part, in characters (base64 text of the compressed save).
export const MAX_RUN_SAVE_PART_BYTES = 12 * 1024
// Most parts one save may have.
export const MAX_RUN_SAVE_PARTS = 16
const MAX_ID_LENGTH = 64
const HASH_PATTERN = /^[0-9a-f]{64}$/i

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown, max: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= max
	)
}

function isNonNegativeInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

// {run, id, index, count, pos, hash, data} -- part `index` (0-based) of `count`
// of a save named `id`. `pos` is how many log events the save was taken after,
// `hash` the SHA-256 of those events' log (the client's own CHK hash input).
// A save replaces the previous one only when its last part arrives; a part of
// a newer save drops the unfinished older one. `run` is required: a part for
// another run is refused `wrong_run`, and one whose `pos` is below the held
// save's is refused `stale_save`.
export const runSavePart: AuthoritativeAction = {
	key: RUN_SAVE_PART_KEY,
	reduce(lobby, ctx, params) {
		if (!lobby.game.started) return { reject: 'not_in_game' }
		if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
		if (
			!isPlainObject(params) ||
			typeof params.run !== 'string' ||
			typeof params.id !== 'string' ||
			params.id.length === 0 ||
			params.id.length > MAX_ID_LENGTH ||
			!isCount(params.count, MAX_RUN_SAVE_PARTS) ||
			!isNonNegativeInt(params.index) ||
			params.index >= params.count ||
			!isNonNegativeInt(params.pos) ||
			typeof params.hash !== 'string' ||
			!HASH_PATTERN.test(params.hash) ||
			typeof params.data !== 'string' ||
			params.data.length > MAX_RUN_SAVE_PART_BYTES
		)
			return { reject: 'bad_params' }
		// Sent for a run the server has since restarted: not this run's.
		if (params.run !== lobby.game.started.runId) return { reject: 'wrong_run' }

		const game = lobby.game
		// The held save's position never goes back, so it always pairs with a
		// prefix of the log at least as long as the one before.
		const kept = game.runSaves?.[ctx.from]
		if (kept && params.pos < kept.pos) return { reject: 'stale_save' }
		const held = game.runSavePending?.[ctx.from]
		const same =
			held &&
			held.id === params.id &&
			held.count === params.count &&
			held.pos === params.pos &&
			held.hash === params.hash
		const pending: PendingRunSave = same
			? { ...held, parts: { ...held.parts } }
			: {
					id: params.id,
					count: params.count,
					pos: params.pos,
					hash: params.hash,
					parts: {},
				}
		pending.parts[String(params.index)] = params.data

		const rest = { ...(game.runSavePending ?? {}) }
		if (Object.keys(pending.parts).length < pending.count) {
			return {
				game: { ...game, runSavePending: { ...rest, [ctx.from]: pending } },
				params: null,
				to: 'none',
			}
		}
		delete rest[ctx.from]
		let data = ''
		for (let i = 0; i < pending.count; i++) data += pending.parts[String(i)]
		const save: RunSave = {
			id: pending.id,
			pos: pending.pos,
			hash: pending.hash,
			data,
			at: ctx.now,
		}
		return {
			game: {
				...game,
				runSaves: { ...(game.runSaves ?? {}), [ctx.from]: save },
				runSavePending: rest,
			},
			params: null,
			to: 'none',
		}
	},
}
