// Keeps PVP_RELAY_KEYS (sender_guard.ts) in step with the PvP mod.
//
// pvp_relay_keys.fixture.json is the list of pvp_* action keys the mod names.
// To regenerate it after the mod changes:
//   node scripts/pvp-relay-keys.mjs <path to the PvP mod>
// (run from nakama/; it rewrites the fixture). A key the fixture gains must be
// added to PVP_RELAY_KEYS if the server should relay it; a key the mod drops
// must be removed from both.
import { describe, expect, it } from 'vitest'
import { extractPvpKeys, scanLua } from '../../scripts/pvp-relay-keys.mjs'
import fixture from './pvp_relay_keys.fixture.json'
import { PVP_RELAY_KEYS } from './sender_guard'

describe('PVP_RELAY_KEYS against the client fixture', () => {
	it('relays every key the client names', () => {
		const missing = fixture.filter((key) => !PVP_RELAY_KEYS.includes(key))
		expect(missing).toEqual([])
	})

	it('names no key the client lacks', () => {
		const extra = PVP_RELAY_KEYS.filter((key) => !fixture.includes(key))
		expect(extra).toEqual([])
	})
})

describe('extractPvpKeys', () => {
	it.each([
		['A(', 'A("pvp_one", function() end)'],
		['A_host(', 'A_host("pvp_one", handler)'],
		['relay(', 'relay("pvp_one", "wireName")'],
		['broadcast(', 'broadcast("pvp_one", { time = 1 })'],
		[
			'ActionTypes[',
			'lobby:action(MPAPI.ActionTypes["pvp_one"]):broadcast({})',
		],
		[
			'ActionType({ key =',
			'MPAPI.ActionType({\n\tkey = "pvp_one",\n\tprefix_config = {},\n})',
		],
		['single quotes', "relay('pvp_one', 'wireName')"],
		['a method call', 'lobby:broadcast("pvp_one", {})'],
	])('collects a key written as %s', (_form, lua) => {
		expect(extractPvpKeys(lua)).toEqual(['pvp_one'])
	})

	it.each([
		['host_only(', 'host_only("pvp_one")'],
		['apply(', 'apply("pvp_one")'],
		['a page show', 'MPAPI.pages.show_lobby("pvp_one")'],
		['a layer', 'MPAPI.Layer("pvp_timer")'],
		['is_layer_active(', 'if MPAPI.is_layer_active("pvp_timer") then end'],
		['load_mp_dir(', 'load_mp_dir("pvp_api")'],
		['pvp_create_private_lobby(', 'pvp_create_private_lobby("pvp_one")'],
		['a game mode key', 'MPAPI.GameMode({\n\tkey = "pvp_royale",\n})'],
		['a table field key', '{ key = "pvp_ranked_vanilla", label = "x" }'],
		['an atlas key', 'SMODS.Atlas({ key = "pvp_title", path = "t.png" })'],
		['a longer function name', 'my_relay("pvp_one")'],
		['a non-pvp key', 'relay("mpapi_one", "wire")'],
	])('ignores %s', (_form, lua) => {
		expect(extractPvpKeys(lua)).toEqual([])
	})

	it('returns each key once, sorted, across a whole file', () => {
		const lua = [
			'relay("pvp_b", "b")',
			'broadcast("pvp_a", {})',
			'broadcast("pvp_b", {})',
			'host_only("pvp_z")',
		].join('\n')
		expect(extractPvpKeys(lua)).toEqual(['pvp_a', 'pvp_b'])
	})

	it.each([
		['ActionType without parens', 'MPAPI.ActionType{ key = "pvp_one" }'],
		[
			'a field before key',
			'MPAPI.ActionType({\n\tprefix_config = { key = false },\n\tkey = "pvp_one",\n})',
		],
		[
			'a comment before key',
			'MPAPI.ActionType({\n\t-- key = "pvp_wrong",\n\tkey = "pvp_one",\n})',
		],
		[
			'a nested parameter key that is not the action key',
			'MPAPI.ActionType({\n\tkey = "pvp_one",\n\tparameters = { { key = "pvp_two" } },\n})',
		],
		['a commented-out call', 'relay("pvp_one", "w")\n-- relay("pvp_two", "w")'],
	])('collects the right key for %s', (_form, lua) => {
		expect(extractPvpKeys(lua)).toEqual(['pvp_one'])
		expect(scanLua(lua).misses).toEqual([])
	})
})

describe('scanLua call sites it cannot read', () => {
	it.each([
		['A(k)', 'local k = "pvp_one"\nA(k, function() end)'],
		['A_host(k)', 'A_host(k)'],
		['relay(k)', 'relay(k, "wire")'],
		['ActionType with a variable key', 'MPAPI.ActionType({ key = k })'],
		['ActionType with no key', 'MPAPI.ActionType({ on_receive = f })'],
		['ActionType given a variable', 'MPAPI.ActionType(def)'],
	])('reports %s as a miss, with its line', (_form, lua) => {
		const { misses } = scanLua(lua)
		expect(misses).toHaveLength(1)
		expect(misses[0].line).toBe(lua.split('\n').length)
		expect(extractPvpKeys(lua)).toEqual([])
	})

	it('names the line of a miss after other lines', () => {
		const lua = 'relay("pvp_a", "w")\n\n-- note\nA(k)'
		expect(scanLua(lua)).toEqual({
			keys: ['pvp_a'],
			misses: [{ line: 4, text: 'A(k)' }],
		})
	})

	it('accepts the helper definitions and what they forward', () => {
		const lua = [
			'function PVP.helpers.A(key, on_receive)',
			'\tMPAPI.ActionType({ key = key, on_receive = on_receive })',
			'end',
			'function PVP.helpers.relay(key, wire)',
			'\tPVP.helpers.A(key, function() end)',
			'end',
			'relay("pvp_one", "w")',
		].join('\n')
		expect(scanLua(lua)).toEqual({ keys: ['pvp_one'], misses: [] })
	})

	it('still reports a variable that is not the helper parameter', () => {
		const lua = 'function H.A(key) end\nA(other)'
		expect(scanLua(lua).misses).toEqual([{ line: 2, text: 'A(other)' }])
	})

	it("does not count another mod's string key as a miss", () => {
		expect(scanLua('relay("mpapi_one", "w")\nA("other", f)').misses).toEqual([])
	})
})
