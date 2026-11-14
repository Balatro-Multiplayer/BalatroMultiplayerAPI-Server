// changedKeys: a value counts as changed only when its JSON differs, whatever
// order its maps list their keys in.
import { afterEach, describe, expect, it } from 'vitest'
import {
	changedKeys,
	registerMatchKey,
	unregisterMatchKey,
} from './match_state'
import { type Lobby, newLobby } from './state'

const KEY = 'test.value'
// A real lobby (the static pvp.* keys project it too) carrying the test value.
const base = newLobby({
	code: 'ABCD',
	modId: 'M',
	maxPlayers: 8,
	creatorId: 'u1',
	now: 0,
	graceMs: 60_000,
})
const lobbyWith = (value: unknown) => ({ ...base, value }) as unknown as Lobby

describe('changedKeys', () => {
	afterEach(() => unregisterMatchKey(KEY))

	it.each([
		[
			'the same nested map in another key order',
			{ a: { x: 1, y: [1, { p: 1, q: 2 }] }, b: 2 },
			{ b: 2, a: { y: [1, { q: 2, p: 1 }], x: 1 } },
			false,
		],
		[
			'a nested value changed',
			{ a: { x: 1, y: 2 } },
			{ a: { y: 2, x: 3 } },
			true,
		],
		['an array reordered', { a: [1, 2] }, { a: [2, 1] }, true],
		[
			'an undefined field against a missing one',
			{ a: undefined, b: 1 },
			{ b: 1 },
			false,
		],
		['null against a value', { a: null }, { a: 0 }, true],
		['a key added', { a: 1 }, { a: 1, b: 1 }, true],
	])('%s', (_name, before, after, changed) => {
		registerMatchKey(KEY, (l) => (l as unknown as { value: unknown }).value)
		expect(changedKeys(lobbyWith(before), lobbyWith(after)).includes(KEY)).toBe(
			changed,
		)
	})
})
