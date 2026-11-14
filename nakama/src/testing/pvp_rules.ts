// A complete set of the lobby metadata keys the rules freeze from (docs/pvp-match.md
// section 4), as the client writes them (PVP.pvp_lobby_metadata, lobby defaults in
// the PvP mod's core.lua). The server invents no default for a missing key, so a
// test lobby that starts a refereed game carries these; a test overrides the key it
// is about.
export const FULL_RULES: { [key: string]: unknown } = {
	ruleset: 'ruleset_mp_traditional',
	queue_mode: 'pvp_nemesis',
	starting_lives: 4,
	manhunt_hunter_lives: 7,
	pvp_start_round: 2,
	timer_base_seconds: 150,
	timer_forgiveness: 0,
	timer_increment_seconds: null,
}

// FULL_RULES with the given keys replaced; a key set to `undefined` is removed.
export function withRules(over: { [key: string]: unknown } = {}): {
	[key: string]: unknown
} {
	const merged = { ...FULL_RULES, ...over }
	for (const key of Object.keys(merged))
		if (merged[key] === undefined) delete merged[key]
	return merged
}
