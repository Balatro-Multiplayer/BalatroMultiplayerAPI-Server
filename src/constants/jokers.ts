export const STANDARD_JOKERS: ReadonlySet<string> = new Set([
	'j_joker',
	'j_mime',
	'j_chaos',
	'j_space',
	'j_scholar',
	'j_egg',
	'j_burglar',
	'j_runner',
	'j_sixth_sense',
	'j_hiker',
	'j_card_sharp',
	'j_madness',
	'j_vampire',
	'j_baron',
	'j_fortune_teller',
	'j_luchador',
	'j_lucky_cat',
	'j_bull',
	'j_swashbuckler',
	'j_throwback',
	'j_mr_bones',
	'j_ring_master',
	'j_idol',
	'j_merry_andy',
	'j_stuntman',
	'j_matador',
	'j_troubadour',
	'j_ancient',
	'j_even_steven',
	'j_odd_todd',
])

export const PRIVILEGED_JOKERS: ReadonlySet<string> = new Set([
	'j_hack',
	'j_vagabond',
	'j_hologram',
	'j_photograph',
	'j_hallucination',
	'j_baseball',
	'j_sock_and_buskin',
	'j_blueprint',
	'j_brainstorm',
	'j_invisible',
	'j_chicot',
	'j_perkeo',
	'j_triboulet',
	'j_yorick',
	'j_caino',
])

export const ALL_VALID_JOKERS: ReadonlySet<string> = new Set([
	...STANDARD_JOKERS,
	...PRIVILEGED_JOKERS,
])

export function isValidJoker(id: string): boolean {
	return ALL_VALID_JOKERS.has(id)
}
