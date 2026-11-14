// Which relayed actions reach other players, and who may send them. Pure.
//
// PvP games are refereed by the server (lobby/pvp): lives, rounds, targets and
// results come from the match state, never from a client's message. So the
// relay forwards only the `pvp_*` actions the client still needs between
// players (PVP_RELAY_KEYS). Every other `pvp_*` key (the old host referee's
// outputs, the old inputs, anything made up) reaches nobody, whoever sends it,
// so a modified client has nothing to forge in the game itself. What is relayed is
// display data between players and is not checked: pvp_player_result carries the
// sender's own claimed highest score and jokers for the end screen and roster. Ratings,
// places and the placements metric come from the match state, never from this field.
// The list is the whole rule: a new client action must be added to it.
//
// The Speedrunning mod is still refereed by its host, so a few of its
// match-deciding actions are ruled by sender below. The host of record is the
// lobby's own `hostId`, which moves with a host transfer (state.ts
// transferHostFrom).
import type { Lobby } from './state'

// The `pvp_*` actions relayed between players, sorted. A test checks it against
// the keys the PvP client registers (pvp_relay_keys.test.ts).
export const PVP_RELAY_KEYS: readonly string[] = [
	'pvp_end_game_stats_requested',
	'pvp_get_end_game_jokers',
	'pvp_get_nemesis_deck',
	'pvp_location',
	'pvp_log_event',
	'pvp_nemesis_end_game_stats',
	'pvp_player_result',
	'pvp_receive_end_game_jokers',
	'pvp_receive_nemesis_deck',
]

// 'host': only the host of record sends it (the SPDRN host's timeout/draw/reseed).
// 'self': `params.player_id` names the sender.
// 'self_or_host': the player claims it for itself, or the host declares it for
//   another (a SPDRN forfeit win: the host's check_single_survivor names the
//   one player left).
export type SenderRule = 'host' | 'self' | 'self_or_host'

export const SENDER_RULES = {
	// SPDRN host decisions.
	spdrn_match_timeout: 'host', // matchmaking/duration.lua: host clock
	spdrn_match_draw: 'host', // ui/lobby/draw_vote.lua: host on unanimity
	spdrn_seed_change_apply: 'host', // ui/lobby/seed_vote.lua: host on unanimity
	// SPDRN results keyed on a param id.
	spdrn_player_won: 'self_or_host',
	spdrn_player_result: 'self', // matchmaking/result.lua: player_id = own id
} as const satisfies { [key: string]: SenderRule }

export type RuledKey = keyof typeof SENDER_RULES

export type SenderRefusal =
	| { kind: 'not_relayed'; key: string; from: string; hostId: string }
	| { kind: 'not_host'; key: RuledKey; from: string; hostId: string }
	| {
			kind: 'not_self'
			key: RuledKey
			from: string
			hostId: string
			// What the payload claimed instead; null when it named nobody.
			claimed: string | null
	  }

export function senderRuleOf(key: string): SenderRule | null {
	return Object.prototype.hasOwnProperty.call(SENDER_RULES, key)
		? SENDER_RULES[key as RuledKey]
		: null
}

function claimedPlayer(params: unknown): string | null {
	if (typeof params !== 'object' || params === null || Array.isArray(params))
		return null
	const id = (params as { [key: string]: unknown }).player_id
	return typeof id === 'string' ? id : null
}

// Why `from` may not send `key` with `params`, or null when it may.
export function senderRefusal(
	lobby: Lobby,
	from: string,
	key: string,
	params: unknown,
): SenderRefusal | null {
	const hostId = lobby.hostId
	if (key.startsWith('pvp_') && !PVP_RELAY_KEYS.includes(key))
		return { kind: 'not_relayed', key, from, hostId }
	const rule = senderRuleOf(key)
	if (rule === null) return null
	const ruled = key as RuledKey
	const isHost = from === hostId
	if (rule === 'host')
		return isHost ? null : { kind: 'not_host', key: ruled, from, hostId }
	if (rule === 'self_or_host' && isHost) return null
	const claimed = claimedPlayer(params)
	return claimed === from
		? null
		: { kind: 'not_self', key: ruled, from, hostId, claimed }
}
