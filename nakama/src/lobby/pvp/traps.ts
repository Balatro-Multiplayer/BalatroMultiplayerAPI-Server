// The trap reducers: pvp.trap_plant, pvp.trap_fire
// and pvp.trap_lost. The server assigns every trap id, owner and holder; the holder
// builds the card from the key and sends only the key. A fire carries data the server
// only bounds; what it means is the mod's. Pure: plain state in, plain result out.
import { MAX_PLANTS_PER_PLANTER, begin, onlyKeys } from './opponent_facts'
import {
	type OpponentResult,
	type OpponentState,
	PVP_TRAPS_KEY,
	type TrapData,
	type TrapRecord,
} from './opponent_state'
import { recordTargets } from './opponent_targets'
import { isCount, isName, isRecord } from './payload'
import { refuse } from './reducer'

export const ARCANE_LOCK_KEY = 'c_mp_trap_arcane_lock'

const MAX_KEY_CHARS = 64
const MAX_DATA_BYTES = 512

// A trap key is the client's own: a `c_mp_` card key of bounded length.
const isTrapKey = (key: string): boolean =>
	key.startsWith('c_mp_') && isName(key, MAX_KEY_CHARS)

// A fire's data is whatever the key's card needs to settle, so the server keeps it
// as the client sent it, bounded. Arcane Lock never takes a client fire: the server
// spends it when it bounces a plant.
function validateFire(key: string, data: TrapData | undefined): TrapData | null {
	if (key === ARCANE_LOCK_KEY) return null
	if (data === undefined) return {}
	return JSON.stringify(data).length <= MAX_DATA_BYTES ? data : null
}

// ---- pvp.trap_plant ----

// A planter's traps held by `holder`, whoever owns them.
const plantedFor = (traps: TrapRecord[], owner: string, holder: string): number =>
	traps.filter((t) => t.owner === owner && t.holder === holder).length

// pvp.trap_plant {runId, key}: the server makes one record per `each` target of the
// planter's frozen row, with the planter as owner. A planter who holds live Arcane
// Locks bounces to the oldest (lowest id): exactly one record, held by the planter
// and owned by the lock's owner, and the lock is spent as
// `{fired: {bounced: <new id>}}`. A plant that carries anything but the key
// (a client-serialized card) is `bad_payload`.
export function reduceTrapPlant(
	state: OpponentState,
	id: string,
	args: unknown,
): OpponentResult {
	const begun = begin(state, id, args)
	if (!begun.ok) return begun
	const a = begun.args
	if (!onlyKeys(a, ['runId', 'key']) || typeof a.key !== 'string')
		return refuse('bad_payload')
	const key = a.key
	if (!isTrapKey(key)) return refuse('unknown_trap')
	if ((state.round.players[id]?.ante ?? null) === null)
		return refuse('no_progress')
	const { trapSeq, traps } = state.facts.traps
	const lock = oldestLock(traps, id)
	if (lock !== undefined) {
		if (plantedFor(traps, lock.owner, id) >= MAX_PLANTS_PER_PLANTER)
			return refuse('over_cap')
		const made: TrapRecord = {
			id: trapSeq,
			key,
			owner: lock.owner,
			holder: id,
			state: 'live',
		}
		const spent = traps.map((t) =>
			t.id === lock.id ? { ...t, state: { fired: { bounced: made.id } } } : t,
		)
		return {
			ok: true,
			state: withTraps(state, trapSeq + 1, [...spent, made]),
			changed: [PVP_TRAPS_KEY],
			reply: { kind: 'accepted' },
		}
	}
	const hit = recordTargets(state, id, 'each')
	if (!hit.ok) return refuse(hit.reason)
	if (hit.targets.some((holder) => plantedFor(traps, id, holder) >= MAX_PLANTS_PER_PLANTER))
		return refuse('over_cap')
	const made: TrapRecord[] = hit.targets.map((holder, i) => ({
		id: trapSeq + i,
		key,
		owner: id,
		holder,
		state: 'live',
	}))
	return {
		ok: true,
		state: withTraps(hit.state, trapSeq + made.length, [...traps, ...made]),
		changed: [PVP_TRAPS_KEY, ...hit.changed],
		reply: { kind: 'accepted' },
	}
}

const oldestLock = (
	traps: TrapRecord[],
	holder: string,
): TrapRecord | undefined =>
	traps
		.filter(
			(t) =>
				t.holder === holder && t.key === ARCANE_LOCK_KEY && t.state === 'live',
		)
		.reduce<TrapRecord | undefined>(
			(best, t) => (best === undefined || t.id < best.id ? t : best),
			undefined,
		)

const withTraps = (
	state: OpponentState,
	trapSeq: number,
	traps: TrapRecord[],
): OpponentState => ({
	...state,
	facts: { ...state.facts, traps: { trapSeq, traps } },
})

// ---- pvp.trap_fire, pvp.trap_lost ----

type Held =
	| { ok: true; trap: TrapRecord; state: OpponentState }
	| { ok: false; reason: string }

// The live trap `trapId` that `id` holds, or the refusal: `not_holder` for an
// unknown trap or another holder, `already_fired` for one that is spent or lost.
function heldLive(state: OpponentState, id: string, trapId: number): Held {
	const trap = state.facts.traps.traps.find((t) => t.id === trapId)
	if (trap === undefined || trap.holder !== id)
		return { ok: false, reason: 'not_holder' }
	if (trap.state !== 'live') return { ok: false, reason: 'already_fired' }
	return { ok: true, trap, state }
}

function settled(
	state: OpponentState,
	trapId: number,
	next: TrapRecord['state'],
): OpponentResult {
	const traps = state.facts.traps.traps.map((t) =>
		t.id === trapId ? { ...t, state: next } : t,
	)
	return {
		ok: true,
		state: withTraps(state, state.facts.traps.trapSeq, traps),
		changed: [PVP_TRAPS_KEY],
		reply: { kind: 'accepted' },
	}
}

// pvp.trap_fire {runId, trapId, data}: the holder springs a live trap; `data` passes
// the key's validator and the server's completed data is what is recorded.
export function reduceTrapFire(
	state: OpponentState,
	id: string,
	args: unknown,
): OpponentResult {
	const begun = begin(state, id, args)
	if (!begun.ok) return begun
	const a = begun.args
	if (
		!onlyKeys(a, ['runId', 'trapId', 'data']) ||
		!isCount(a.trapId) ||
		(a.data !== undefined && !isRecord(a.data))
	)
		return refuse('bad_payload')
	const held = heldLive(state, id, a.trapId)
	if (!held.ok) return refuse(held.reason)
	const data = validateFire(held.trap.key, a.data)
	if (data === null) return refuse('bad_payload')
	return settled(state, a.trapId, { fired: data })
}

// pvp.trap_lost {runId, trapId}: the holder reports an explicit destroy of an
// unfired card.
export function reduceTrapLost(
	state: OpponentState,
	id: string,
	args: unknown,
): OpponentResult {
	const begun = begin(state, id, args)
	if (!begun.ok) return begun
	const a = begun.args
	if (!onlyKeys(a, ['runId', 'trapId']) || !isCount(a.trapId))
		return refuse('bad_payload')
	const held = heldLive(state, id, a.trapId)
	if (!held.ok) return refuse(held.reason)
	return settled(state, a.trapId, 'lost')
}
