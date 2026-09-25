import type { MatchRecord } from './types.js'

// Deterministic violent-threat tier. Runs BEFORE the guard so a 0.6B model's
// fuzziness at the threat boundary can never let a directed threat through
// (measured 2026-07-09: the tuned guard rated "i will execute your family" and
// "i will fucking kill you" Safe). This tier is intentionally NARROW — it fires
// only on a violence verb aimed at a PERSON/FAMILY target, which is what keeps
// it from re-flagging the game-speak the guard fine-tune exists to allow
// ("execute the combo", "i'll kill this run", "destroy you" as trash-talk).
//
// Two rungs, both requiring a person target:
//   A) lethal/unambiguous verbs (kill, murder, execute, behead, ...):
//        - + a family target            -> block  (never benign)
//        - + bare "you", WITH a first-person intent lead-in ("i will kill you")
//          -> block. The intent lead-in rules out hyperbole ("that boss will
//          kill you") whose subject is not the speaker.
//   B) banter-capable verbs (destroy, end, beat, hurt, ...):
//        - + a FAMILY target only       -> block  ("destroy you" stays banter,
//          "destroy your family" does not).
//
// The guard still backs everything this tier does not match; this is a floor,
// not the whole net. New misses get pinned here and in the canary gate.

const LEET: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'7': 't',
	'8': 'b',
	'!': 'i',
	'@': 'a',
	$: 's',
}

/** Lowercase, de-leet, reduce punctuation to spaces, and join letter-spacing
 *  ("k1ll.you", "kill   you", "k i l l you" all normalize to "kill you"). */
function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[0134578!@$]/g, (c) => LEET[c] ?? c)
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/(?:\b[a-z]\b ){2,}\b[a-z]\b/g, (s) => s.replace(/ /g, ''))
		.trim()
}

/** Turns a word into a stretch-tolerant pattern: a single letter may repeat
 *  ("kiiill"), and a genuinely-doubled letter must still appear at least twice
 *  ("kill" -> k+i+l{2,}, so "kil"/"skil" can't collide with it). */
function stretch(word: string): string {
	let out = ''
	for (let i = 0; i < word.length; ) {
		const c = word[i]
		let n = 1
		while (word[i + n] === c) n++
		out += `${c}${n >= 2 ? `{${n},}` : '+'}`
		i += n
	}
	return out
}

const alt = (words: string[]) => words.map(stretch).join('|')

// A: lethal verbs, never benign in a directed sentence.
const VERBS_A = [
	'kill',
	'murder',
	'execute',
	'behead',
	'decapitate',
	'slaughter',
	'strangle',
	'lynch',
	'massacre',
	'assassinate',
	'rape',
	'stab',
	'torture',
	'maim',
	'mutilate',
	'dismember',
	'crucify',
	'exterminate',
	'eviscerate',
	'butcher',
]
// B: violent but usable as trash-talk with a bare target -> family target only.
const VERBS_B = [
	'destroy',
	'end',
	'beat',
	'bash',
	'smash',
	'wreck',
	'hurt',
	'harm',
	'gut',
	'choke',
	'finish',
	'kidnap',
	'gas',
]

// Family / loved-one nouns. A possessive ("your"/"ur") + up to two filler words
// (adjectives, "fucking"/"whole") + a family noun.
const FAMILY_NOUNS = [
	'family',
	'fam',
	'mom',
	'mommy',
	'mother',
	'mum',
	'dad',
	'daddy',
	'father',
	'kid',
	'kids',
	'child',
	'children',
	'son',
	'daughter',
	'sister',
	'sis',
	'brother',
	'bro',
	'wife',
	'husband',
	'parent',
	'parents',
	'grandma',
	'grandmother',
	'grandpa',
	'grandfather',
	'baby',
	'gf',
	'girlfriend',
	'bf',
	'boyfriend',
	'bloodline',
	'lineage',
	'household',
]
const POSSESSIVE = '(?:your|ur|yr|ya)'
const FAMILY = `(?:${POSSESSIVE}(?:\\s+\\w+){0,2}\\s+(?:${alt(FAMILY_NOUNS)})|everyone\\s+(?:you|u)\\s+lov(?:e|es)|(?:your|ur)\\s+lov(?:ed)?\\s+ones)`
// Bare second-person target (not "yourself" — that's the self-harm denylist).
const YOU = '(?:you|u|ya|yall|y\\s?all)'
// First-person intent lead-in that marks the speaker as the actor.
const INTENT = '\\b(?:i|im|ima|imma|we)\\b'
// 0-3 filler words between pieces.
const GAP = '(?:\\s+\\w+){0,3}?\\s+'

const bound = (p: string) => `\\b(?:${p})\\b`

const RE_A_FAMILY = new RegExp(`${bound(alt(VERBS_A))}${GAP}${FAMILY}`, 'g')
const RE_A_YOU = new RegExp(
	`${INTENT}${GAP}${bound(alt(VERBS_A))}${GAP}${YOU}\\b`,
	'g',
)
const RE_B_FAMILY = new RegExp(`${bound(alt(VERBS_B))}${GAP}${FAMILY}`, 'g')
const PATTERNS: Array<{ kind: string; re: RegExp; youRung?: boolean }> = [
	{ kind: 'threat_lethal', re: RE_A_FAMILY },
	{ kind: 'threat_lethal', re: RE_A_YOU, youRung: true },
	{ kind: 'threat_violent', re: RE_B_FAMILY },
]

// Game-scope exemption for the bare-"you" rung ONLY ("ima kill you in this
// game" is a match taunt, measured live 2026-07-11). Deliberately narrow so it
// can't become a bypass template: the qualifier must END the message (bar a
// short banter tail) — "kill you in this game and then irl" still blocks.
// Family-targeted threats are NEVER exempted. Runs on the normalized text.
const GAME_SCOPE_TAIL =
	/^\s+(?:in\s+)?(?:(?:this|the|that|next)\s+){1,2}(?:game|run|round|match|lobby)(?:\s+(?:lol|lmao|haha|xd|bro|dude|man))*$/
const IN_GAME_TAIL =
	/^\s+in\s+(?:game|balatro)(?:\s+(?:lol|lmao|haha|xd|bro|dude|man))*$/

function isGameScoped(norm: string, matchEnd: number): boolean {
	const tail = norm.slice(matchEnd)
	return GAME_SCOPE_TAIL.test(tail) || IN_GAME_TAIL.test(tail)
}

/**
 * Finds directed violent threats in `text`. Returns one MatchRecord per
 * distinct matched span (indices into the normalized form; `word` is the
 * matched phrase, for the audit log). Empty array = no threat.
 */
export function findThreats(text: string): MatchRecord[] {
	const norm = normalize(text)
	if (norm === '') return []
	const out: MatchRecord[] = []
	const seen = new Set<string>()
	for (const { re, youRung } of PATTERNS) {
		re.lastIndex = 0
		for (const m of norm.matchAll(re)) {
			const end = (m.index ?? 0) + m[0].length
			// Bare-you matches that are explicitly game-scoped fall through to
			// the guard instead of hard-blocking (see GAME_SCOPE_TAIL above).
			if (youRung && isGameScoped(norm, end)) continue
			const word = m[0].trim()
			const key = `${m.index}:${word}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push({
				word,
				startIndex: m.index ?? 0,
				endIndex: end,
			})
		}
	}
	return out
}
