// The match state keys clients mirror (docs/pvp-match.md, Wire: SNAPSHOT.match, STATE.changed).
// A key is a name and a pure projection of the lobby; MATCH_KEYS below lists them
// all, so no key depends on an import having run first.
//
// Who sends a STATE (each bumps the rev once and names the keys it changed):
//   - requests.ts handleRequest: the keys a request's reducer changed;
//   - requests.ts requestStep: the drift of a settle that ended the game;
//   - match.ts apply (announceDrift): any step that moved match state without
//     announcing it (a game start, restart or end resets lobby.game);
//   - pvp/referee.ts pvpTick: what the PvP tick changed. The reset a finish makes
//     afterwards is not announced, so a client keeps the final pvp.* values;
//   - state.ts: a Ready dropped on a disconnect or a removed seat.
// The full STATE of a snapshot request (requests.ts) is the one that does not
// bump the rev.
import { ServerOp, type StateMessage } from './protocol'
import { maskedFor } from './pvp/mask'
import { PVP_READY_KEY, projectReady } from './pvp/ready'
import { PVP_ROUND_KEY } from './pvp/reducer'
import { refereeOf } from './pvp/state'
import {
	MASKED_PROJECTIONS,
	PVP_PROJECTIONS,
	PVP_SOURCES,
	PVP_TARGETS_KEY,
	VIEWER_PROJECTIONS,
} from './pvp/view'
import type { Lobby, Step } from './state'

import type { KeyProjection } from './request_types'
export type { KeyProjection }

// Every match key with its projection: the refereed keys (pvp/view.ts) and
// pvp.ready (pvp/ready.ts).
const MATCH_KEYS: { [key: string]: KeyProjection } = {
	...PVP_PROJECTIONS,
	[PVP_READY_KEY]: projectReady,
}

// A copy, so a test can add or drop a key.
const projections: { [key: string]: KeyProjection } = { ...MATCH_KEYS }

// Test seam: add a key.
export function registerMatchKey(key: string, project: KeyProjection): void {
	projections[key] = project
}

// Test seam: forget a registered key.
export function unregisterMatchKey(key: string): void {
	delete projections[key]
}

export function matchKeys(): string[] {
	return Object.keys(projections)
}

// The named keys' current values; unregistered names are skipped.
// `masked` gives the score-hiding variant of the keys that have one (pvp/view.ts).
// A per-viewer key (VIEWER_PROJECTIONS) shows `viewer`'s own value; with no viewer
// it is left out, since its registered projection only detects change.
export function matchStateOf(
	lobby: Lobby,
	keys: string[] = matchKeys(),
	masked = false,
	viewer?: string,
): { [key: string]: unknown } {
	const out: { [key: string]: unknown } = {}
	for (const key of keys) {
		if (isPerViewer(key)) {
			if (viewer !== undefined) out[key] = VIEWER_PROJECTIONS[key](lobby, viewer)
			continue
		}
		const project = (masked && MASKED_PROJECTIONS[key]) || projections[key]
		if (project) out[key] = project(lobby)
	}
	return out
}

function isPerViewer(key: string): boolean {
	return Object.prototype.hasOwnProperty.call(VIEWER_PROJECTIONS, key)
}

// Whether `viewer` is masked in the lobby's PvP game (pvp/mask.ts maskedFor).
export function maskedIn(lobby: Lobby, viewer: string): boolean {
	return maskedFor(refereeOf(lobby), viewer)
}

export function revOf(lobby: Lobby): number {
	return lobby.rev ?? 1
}

// Match state changed (keys named): rev + 1 and one STATE to every seated
// player. Call once per batch of change, and only when something did change.
// The server's own triggers (a disconnect, a removed seat) use this too.
//
// Each player gets one message, but not always the same one: a masked player
// (pvp/mask.ts maskedFor) gets the score-free pvp.round and pvp.targets. So the
// players are grouped by what they may see and each group's payload is built
// once. Pass the lobby from before the change as `before`: a player whose mask
// flipped (they just played a hand) then gets pvp.round and pvp.targets even if
// `keys` named neither, or they would stay masked until the next change. The rev
// and `keys` are from the unmasked state; a masked player is not sent a masked key
// (pvp.round, pvp.targets) whose masked value did not change, since its arrival
// would show that a score or the ranking moved.
export function announceChange(
	lobby: Lobby,
	keys: string[],
	before?: Lobby,
): Step {
	// The idle tick: nothing named and nothing before to compare, so no flip either.
	if (keys.length === 0 && (before === undefined || before === lobby))
		return { lobby, out: [] }
	const state = refereeOf(lobby)
	const stateBefore = before === undefined ? state : refereeOf(before)
	const viewers = lobby.players.map((p) => {
		const masked = maskedFor(state, p.id)
		const flipped = maskedFor(stateBefore, p.id) !== masked
		return { id: p.id, masked, flipped }
	})
	if (keys.length === 0 && !viewers.some((v) => v.flipped))
		return { lobby, out: [] }
	const next: Lobby = { ...lobby, rev: revOf(lobby) + 1 }
	// Each key is projected once per variant and shared across the groups.
	const projected = new Map<string, { [key: string]: unknown }>()
	const partOf = (key: string, masked: boolean): { [key: string]: unknown } => {
		const id = `${masked}:${key}`
		let part = projected.get(id)
		if (part === undefined) {
			part = matchStateOf(next, [key], masked)
			projected.set(id, part)
		}
		return part
	}
	// A per-viewer key is projected per viewer id, not per mask variant.
	const viewerPart = (
		key: string,
		viewer: string,
	): { [key: string]: unknown } => {
		const id = `${viewer}:${key}`
		let part = projected.get(id)
		if (part === undefined) {
			part = matchStateOf(next, [key], false, viewer)
			projected.set(id, part)
		}
		return part
	}
	const perViewerShown = keys.some(isPerViewer)
	const groups = new Map<string, { sendTo: string[]; msg: StateMessage }>()
	for (const v of viewers) {
		const id = perViewerShown ? v.id : `${v.masked}:${v.flipped}`
		const group = groups.get(id)
		if (group) {
			group.sendTo.push(v.id)
			continue
		}
		let shown = v.flipped
			? [...new Set([...keys, PVP_ROUND_KEY, PVP_TARGETS_KEY])]
			: keys
		// A masked key whose masked value did not change is not sent either: its
		// arrival alone would tell a masked viewer that the ranking moved.
		if (v.masked && !v.flipped && before !== undefined)
			shown = shown.filter(
				(key) =>
					!MASKED_PROJECTIONS[key] ||
					canonical(MASKED_PROJECTIONS[key](before)) !==
						canonical(MASKED_PROJECTIONS[key](next)),
			)
		// A viewer whose own value of a per-viewer key did not change gets the
		// message without it (dropping the message would leave a rev gap).
		if (before !== undefined)
			shown = shown.filter(
				(key) =>
					!isPerViewer(key) ||
					canonical(VIEWER_PROJECTIONS[key](before, v.id)) !==
						canonical(viewerPart(key, v.id)[key]),
			)
		const changed: { [key: string]: unknown } = {}
		for (const key of shown)
			Object.assign(
				changed,
				isPerViewer(key) ? viewerPart(key, v.id) : partOf(key, v.masked),
			)
		groups.set(id, {
			sendTo: [v.id],
			msg: { rev: revOf(next), changed },
		})
	}
	return {
		lobby: next,
		out: [...groups.values()].map((g) => ({
			kind: 'send',
			op: ServerOp.STATE,
			payload: g.msg,
			to: g.sendTo,
		})),
	}
}

// A value as JSON with every object's keys sorted. The match state comes back
// from Nakama's runtime as Go maps, which list their keys in a new order on
// each read, so plain JSON.stringify sees a change where there is none.
// Projections return plain JSON data (no toJSON, Dates); a missing value and
// null read the same, as they do on the wire.
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (value === null || typeof value !== 'object')
		return JSON.stringify(value) ?? 'null'
	const record = value as { [key: string]: unknown }
	const keys = Object.keys(record)
		.filter((k) => record[k] !== undefined)
		.sort()
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`
}

// True when a key's source facts are the very same objects in both lobbies, so it
// cannot have changed (PVP_SOURCES, pvp/view.ts). A key a test re-registered is
// always projected.
function sameSources(key: string, before: Lobby, after: Lobby): boolean {
	const sources = PVP_SOURCES[key]
	if (sources === undefined || projections[key] !== MATCH_KEYS[key]) return false
	const a = sources(before)
	const b = sources(after)
	return a.length === b.length && a.every((v, i) => v === b[i])
}

// The keys whose value differs between two lobbies. The projections are pure, so
// the same lobby object has no change and nothing is projected, and a key whose
// source facts are untouched is not projected either.
export function changedKeys(before: Lobby, after: Lobby): string[] {
	if (before === after) return []
	return matchKeys().filter(
		(key) =>
			!sameSources(key, before, after) &&
			canonical(projections[key](before)) !==
				canonical(projections[key](after)),
	)
}

// A step that moved match state without announcing it (a game start, restart
// or end resets lobby.game from several places): announce the drift once.
// A step that already bumped the rev announced its own change.
export function announceDrift(before: Lobby, step: Step): Step {
	if (step.lobby.closed || revOf(step.lobby) !== revOf(before)) return step
	const keys = changedKeys(before, step.lobby)
	if (keys.length === 0) return step
	const announced = announceChange(step.lobby, keys, before)
	return { lobby: announced.lobby, out: step.out.concat(announced.out) }
}
