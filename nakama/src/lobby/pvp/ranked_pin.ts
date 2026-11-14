import { PVP_MOD_ID } from '../../standing/pvp_version'
import { clockRowOf } from './settings'

// D1b: a ranked lobby plays the rules of the queue its players joined. The client
// queues one ticket per ruleset ("pvp_ranked_<short>", pvp_api/queue.lua), always as
// a 2-player Nemesis lobby on the client's lobby defaults (core.lua). The server pins
// those keys and refuses a host write that differs, before and after the freeze.

const RANKED_PREFIX = 'pvp_ranked_'
const RANKED_RULESETS: readonly string[] = [
	'balanced',
	'expanded',
	'vanilla',
	'majorleague',
	'smallworld',
]

export type RulePin = { [key: string]: string | number }
export type PinResult =
	| { ok: true; pin: RulePin }
	| { ok: false; reason: 'unknown_ranked_mode' }

export function rankedPinOf(rankedMode: string): PinResult {
	if (!rankedMode.startsWith(RANKED_PREFIX))
		return { ok: false, reason: 'unknown_ranked_mode' }
	const short = rankedMode.slice(RANKED_PREFIX.length)
	if (!RANKED_RULESETS.includes(short))
		return { ok: false, reason: 'unknown_ranked_mode' }
	const ruleset = `ruleset_mp_${short}`
	const found = clockRowOf(ruleset)
	if (!found.ok) return { ok: false, reason: 'unknown_ranked_mode' }
	const pin: RulePin = {
		ruleset,
		queue_mode: 'pvp_nemesis',
		starting_lives: 4,
		pvp_start_round: 2,
		// The client's lobby default (core.lua) and what flow.lua sends: `or 7`.
		manhunt_hunter_lives: 7,
	}
	// A league ruleset forces its own base and forgiveness: nothing to pin there.
	if (!found.row.forcedTimer) {
		pin.timer_base_seconds = 150
		pin.timer_forgiveness = 0
	}
	pin.timer_increment_seconds = 60
	return { ok: true, pin }
}

// Casual lobbies and other mods are not pinned; an unknown PvP ranked mode is refused.
export function pinFor(modId: string, rankedMode: string): PinResult {
	if (modId !== PVP_MOD_ID || rankedMode === '') return { ok: true, pin: {} }
	return rankedPinOf(rankedMode)
}

export type PinSplit = {
	accepted: { [key: string]: unknown }
	refused: string[]
}

export function splitPinnedPatch(
	patch: { [key: string]: unknown },
	pin: RulePin,
): PinSplit {
	const accepted: { [key: string]: unknown } = {}
	const refused: string[] = []
	for (const key of Object.keys(patch)) {
		if (
			Object.prototype.hasOwnProperty.call(pin, key) &&
			patch[key] !== pin[key]
		)
			refused.push(key)
		else accepted[key] = patch[key]
	}
	return { accepted, refused }
}
