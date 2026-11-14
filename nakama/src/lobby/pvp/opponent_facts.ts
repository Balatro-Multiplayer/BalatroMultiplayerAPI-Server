import {
	type EffectKind,
	type Implausible,
	type OpponentPlayer,
	type OpponentResult,
	type OpponentState,
	PVP_EFFECTS_KEY,
	PVP_OPPONENT_KEY,
	type Slot,
} from './opponent_state'
// The fact reducers for the opponent requests: pvp.sell, pvp.shop and pvp.effect. Like
// facts.ts they only RECORD what a client reports; the amounts come from the server's
// tables and the targets from the frozen Nemesis rows (opponent_targets.ts). Pure:
// plain state in, plain result out. A resent request is answered once by its reqId
// (requests.ts), so no reducer numbers or compares requests.
import { recordTargets } from './opponent_targets'
import { type Payload, isCount, isRecord } from './payload'
import { type Refusal, gate, refuse, runIdOf } from './reducer'
import { inRunIgnoringLives } from './state'

export const MAX_SPEND = 1_000_000

// Bounds on what one player can make the state hold.
export const MAX_EFFECTS_PER_ACTOR = 384
export const MAX_PLANTS_PER_PLANTER = 32
export const MAX_SLOTS_PER_PLAYER = 160

// What a kind does and how much: the client sends only the kind. Pizza and Gambling
// fan out to every other alive player, a teammate too, as their broadcast did before
// the server owned them; Asteroid reaches every alive player whose frozen row has
// the sender as its target.
export const EFFECT_KINDS: {
	[kind in EffectKind]: { fan: 'targeting' | 'all'; amount: number }
} = {
	// lower the best-levelled visible hand by 1
	asteroid: { fan: 'targeting', amount: 1 },
	// discards_nemesis = 1
	pizza: { fan: 'all', amount: 1 },
	// nemesis_dollars = 10
	gambling: { fan: 'all', amount: 10 },
}

export function isEffectKind(value: string): value is EffectKind {
	return Object.prototype.hasOwnProperty.call(EFFECT_KINDS, value)
}

// ---- shared request prelude ----

export type Begun = { ok: true; args: Payload } | Refusal

const isSeeded = (state: OpponentState, id: string): boolean =>
	state.facts.opponent.players[id] !== undefined &&
	state.facts.server.players[id] !== undefined &&
	state.facts.effects.players[id] !== undefined &&
	state.facts.nemesis[id] !== undefined

// The refusals that record nothing: a missing runId is `bad_payload`, then the
// common gate, then `not_running` for a run that is not the running one or an actor
// the run never seeded.
export function begin(state: OpponentState, id: string, args: unknown): Begun {
	const runId = runIdOf(args)
	if (runId === null || !isRecord(args)) return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const rules = state.rules
	if (
		rules.runId === null ||
		rules.runId !== state.runId ||
		!isSeeded(state, id)
	)
		return refuse('not_running')
	return { ok: true, args }
}

// True when `args` carries no key outside `keys`.
export const onlyKeys = (args: Payload, keys: string[]): boolean =>
	Object.keys(args).every((key) => keys.includes(key))

const accepted = (state: OpponentState, changed: string[]): OpponentResult => ({
	ok: true,
	state,
	changed,
	reply: { kind: 'accepted' },
})

// ---- pvp.sell ----

// pvp.sell {runId, ante}: one sell of the seller's, in the ante the seller was in.
// The ante is a shape rule (`bad_ante`): at least 1 and at most one above the
// progress ante the server recorded (the post-Boss shop).
export function reduceSell(
	state: OpponentState,
	id: string,
	args: unknown,
): OpponentResult {
	const begun = begin(state, id, args)
	if (!begun.ok) return begun
	const a = begun.args
	if (!onlyKeys(a, ['runId', 'ante']) || !Number.isSafeInteger(a.ante))
		return refuse('bad_payload')
	const ante = a.ante as number
	const progress = state.round.players[id]?.ante ?? null
	if (progress === null) return refuse('no_progress')
	if (ante < 1 || ante > progress + 1) return refuse('bad_ante')
	const player = state.facts.opponent.players[id]
	const sells = { ...player.sells, [ante]: (player.sells[ante] ?? 0) + 1 }
	return accepted(withPlayer(state, id, { ...player, sells }), [
		PVP_OPPONENT_KEY,
	])
}

function withPlayer(
	state: OpponentState,
	id: string,
	player: OpponentPlayer,
): OpponentState {
	return {
		...state,
		facts: {
			...state.facts,
			opponent: {
				players: { ...state.facts.opponent.players, [id]: player },
			},
		},
	}
}

// ---- pvp.effect ----

// pvp.effect {runId, kind}: the client names the kind; the amount is the table's and
// the targets are the actor's frozen `each` row for its server ante. An empty target
// list is a fact: the effect is recorded against nobody.
export function reduceEffect(
	state: OpponentState,
	id: string,
	args: unknown,
): OpponentResult {
	const begun = begin(state, id, args)
	if (!begun.ok) return begun
	const a = begun.args
	if (!onlyKeys(a, ['runId', 'kind']) || typeof a.kind !== 'string')
		return refuse('bad_payload')
	const kind = a.kind
	if (!isEffectKind(kind)) return refuse('unknown_kind')
	if ((state.round.players[id]?.ante ?? null) === null)
		return refuse('no_progress')
	const { fan, amount } = EFFECT_KINDS[kind]
	const hit = recordTargets(state, id, fan)
	if (!hit.ok) return refuse(hit.reason)
	const sentBy = (target: string): number =>
		hit.state.facts.effects.players[target]?.incoming.filter(
			(e) => e.from === id,
		).length ?? 0
	if (hit.targets.some((target) => sentBy(target) >= MAX_EFFECTS_PER_ACTOR))
		return refuse('over_cap')
	const players = { ...hit.state.facts.effects.players }
	for (const target of hit.targets) {
		const p = players[target]
		// A target the run never seeded is not a player of this run.
		if (p === undefined) continue
		players[target] = {
			incoming: [
				...p.incoming,
				{ from: id, n: p.incoming.length + 1, kind, amount },
			],
		}
	}
	return accepted(
		{ ...hit.state, facts: { ...hit.state.facts, effects: { players } } },
		[PVP_EFFECTS_KEY, ...hit.changed],
	)
}

// ---- pvp.shop ----

// `unknown`: a shop slot that happened with no spend field to read.
type ShopPayload = { spent: number } | { skipped: true } | { unknown: true }

function parseShop(args: Payload): ShopPayload | null {
	if (!onlyKeys(args, ['runId', 'spent', 'skipped'])) return null
	const hasSpent = 'spent' in args
	const hasSkipped = 'skipped' in args
	if (hasSpent && hasSkipped) return null
	if (!hasSpent && !hasSkipped) return { unknown: true }
	if (hasSpent) return isCount(args.spent) ? { spent: args.spent } : null
	return args.skipped === true ? { skipped: true } : null
}

// pvp.shop {runId, spent} | {runId, skipped:true}: the next blind slot of the
// sender's own. A skipped slot is accepted only while the recorded pvp.skip total
// exceeds the accepted skipped slots. A refusal is recorded as a refused slot.
export function reduceShop(
	state: OpponentState,
	id: string,
	args: unknown,
): OpponentResult {
	const begun = begin(state, id, args)
	if (!begun.ok) return begun
	const parsed = parseShop(begun.args)
	if (parsed === null) return refuse('bad_payload')
	const player = state.facts.opponent.players[id]
	if (player.slots.length >= MAX_SLOTS_PER_PLAYER) return refuse('over_cap')
	const ante = state.round.players[id]?.ante ?? null
	const made = slotOf(state, id, ante, parsed)
	const slot = made.slot
	return {
		ok: true,
		state: withPlayer(state, id, { ...player, slots: [...player.slots, slot] }),
		changed: [PVP_OPPONENT_KEY],
		reply:
			'refused' in slot
				? made.detail === undefined
					? { kind: 'refused', reason: slot.refused }
					: { kind: 'refused', reason: slot.refused, detail: made.detail }
				: { kind: 'accepted' },
	}
}

// The slot becomes: accepted, or refused for the first reason that applies.
function slotOf(
	state: OpponentState,
	id: string,
	ante: number | null,
	parsed: ShopPayload,
): { slot: Slot; detail?: Implausible } {
	const refuseWith = (refused: string, detail?: Implausible) => ({
		slot: { ante, refused } satisfies Slot,
		detail,
	})
	if (ante === null) return refuseWith('no_progress')
	if ('unknown' in parsed) return refuseWith('bad_spend')
	const player = state.facts.opponent.players[id]
	if ('skipped' in parsed) {
		const total = state.facts.skips[id]?.skips ?? null
		const taken = player.slots.filter((s) => 'skipped' in s).length
		if (total === null || total <= taken) return refuseWith('skip_missing')
	} else if (parsed.spent > MAX_SPEND)
		return refuseWith('implausible', {
			count: parsed.spent,
			cap: MAX_SPEND,
			window: 'slot',
		})
	return {
		slot:
			'skipped' in parsed
				? { ante, skipped: true }
				: { ante, spent: parsed.spent },
	}
}

// `closed` follows the server's lives facts: a player out of the run has no shop
// to read. Returns the same state when nothing changed.
export function syncClosed(state: OpponentState): {
	state: OpponentState
	changed: boolean
} {
	let players = state.facts.opponent.players
	for (const [id, player] of Object.entries(players)) {
		const seat = state.lives.players[id]
		if (seat === undefined) continue
		const closed = !inRunIgnoringLives(seat)
		if (closed !== player.closed)
			players = { ...players, [id]: { ...player, closed } }
	}
	if (players === state.facts.opponent.players) return { state, changed: false }
	return {
		state: {
			...state,
			facts: { ...state.facts, opponent: { players } },
		},
		changed: true,
	}
}
