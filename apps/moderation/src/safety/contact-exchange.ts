// Deterministic PII / contact-exchange / doxxing safety tier (ws08).
//
// Runs on already-normalized text (the pipeline's normalize tier folds leet-
// speak, stretched letters, etc. — see ../pipeline/normalize.ts). This module
// additionally folds obfuscations specific to contact-info evasion (spelled
// digits, spaced digits, "dot"/"at" markers, fullwidth chars) that the
// general scoring normalizer doesn't handle, then runs a fixed battery of
// RE2-safe regexes. Every regex here is a single level of quantification over
// disjoint character classes (or a bounded `{0,n}` chain) — never a quantifier
// nested inside another quantifier over an overlapping alphabet — so none of
// them can exhibit catastrophic backtracking regardless of input.
//
// Per the design review (knowledge/chat-moderation/07-…, item 1): birthdates
// are never stored, so 16-17 can't be distinguished from adults — these
// protections apply to ALL users, not just minors.

export type SafetyMatchKind =
	| 'email'
	| 'phone'
	| 'ip'
	| 'url'
	| 'invite_link'
	| 'social_handle'
	| 'intent_phrase'

export type SafetySeverity = 'red' | 'orange'

export type SafetyMatch = {
	kind: SafetyMatchKind
	severity: SafetySeverity
	span: string
	startIndex: number
	endIndex: number
	pattern: string
}

// --- Obfuscation folding ---

const FULLWIDTH = /[！-～]/g

function foldFullwidth(text: string): string {
	return text.replace(FULLWIDTH, (c) =>
		String.fromCharCode(c.charCodeAt(0) - 0xfee0),
	)
}

// A single dot-obfuscation marker: the spelled word or a bracket/paren form.
// Shared by the generic dot fold and the spaced-"at" email fold below.
const DOT_MARKER_ALT = '(?:\\bdot\\b|\\[dot\\]|\\(dot\\)|\\[\\.\\]|\\(\\.\\))'

// "google dot com", "google[dot]com", "google(dot)com", "google[.]com" -> "google.com".
// Unconditional (unlike "at" below) — "dot" as an evasion marker has no benign
// reading worth protecting against, and downstream detectors still require a
// real domain/TLD shape before anything fires.
const DOT_MARKER = new RegExp(
	`([a-z0-9-]+)\\s*${DOT_MARKER_ALT}\\s*([a-z0-9-]+)`,
	'gi',
)

function foldDotMarkers(text: string): string {
	// A single global pass only folds one "dot" per pair (the matched right-hand
	// word is consumed and unavailable to start the next match). Running twice
	// folds a chain like "co dot uk" that follows an already-folded "google.co".
	let out = text.replace(DOT_MARKER, '$1.$2')
	out = out.replace(DOT_MARKER, '$1.$2')
	return out
}

// "[at]"/"(at)" have no normal-English reading, so they fold unconditionally.
const BRACKET_AT = /\s*(?:\[at\]|\(at\))\s*/gi

function foldBracketAt(text: string): string {
	return text.replace(BRACKET_AT, '@')
}

// Plain " at " only folds to "@" when the domain that follows ALSO spells out
// its dot (e.g. "bob at gmail dot com"). If the domain already has a literal
// "." ("discord.gg", "balatro.wiki"), " at " is virtually always the ordinary
// English preposition ("join us at discord.gg/abc123", "look at this") — a
// real dot there is not itself evidence of an obfuscated email, so folding on
// dot-shape alone would turn every "at <url>" sentence into a false email
// match. Requiring the dot ITSELF to be spelled/bracketed keeps this scoped to
// genuine spell-it-all-out obfuscation.
const SPACED_AT_SPELLED_EMAIL = new RegExp(
	`([a-z0-9_.%+-]+)\\s+at\\s+([a-z0-9-]+(?:\\s*${DOT_MARKER_ALT}\\s*[a-z0-9-]+){1,4})`,
	'gi',
)

function foldSpacedAtSpelledEmail(text: string): string {
	return text.replace(
		SPACED_AT_SPELLED_EMAIL,
		(_match, user: string, domain: string) =>
			`${user}@${domain.replace(new RegExp(`\\s*${DOT_MARKER_ALT}\\s*`, 'gi'), '.')}`,
	)
}

const DIGIT_WORDS: Record<string, string> = {
	zero: '0',
	one: '1',
	two: '2',
	three: '3',
	four: '4',
	five: '5',
	six: '6',
	seven: '7',
	eight: '8',
	nine: '9',
}
const DIGIT_WORD_ALT = Object.keys(DIGIT_WORDS).join('|')

// "five five five one two three four" -> "5551234". Requires 3+ digit words
// in a row (single-char separator per repetition, never a quantified
// separator) so an ordinary "I have two dogs and one cat" never folds.
const SPELLED_DIGIT_RUN = new RegExp(
	`\\b(?:${DIGIT_WORD_ALT})(?:[\\s-](?:${DIGIT_WORD_ALT})){2,}\\b`,
	'gi',
)

function foldSpelledDigits(text: string): string {
	return text.replace(SPELLED_DIGIT_RUN, (match) =>
		match
			.split(/[\s-]/)
			.map((word) => DIGIT_WORDS[word.toLowerCase()] ?? word)
			.join(''),
	)
}

// "5 5 5 1 2 3 4" -> "5551234". Requires 7+ digits total.
const SPACED_DIGIT_RUN = /\b\d(?:[\s.-]\d){6,}\b/g

function foldSpacedDigits(text: string): string {
	return text.replace(SPACED_DIGIT_RUN, (match) => match.replace(/[\s.-]/g, ''))
}

/**
 * Folds contact-exchange obfuscations that the pipeline's general scoring
 * normalizer doesn't handle: fullwidth chars, "dot"/"at" markers, spelled-out
 * and spaced-out digit sequences. Exported for direct testing.
 */
export function foldObfuscations(text: string): string {
	let out = foldFullwidth(text)
	out = foldBracketAt(out)
	out = foldSpacedAtSpelledEmail(out)
	out = foldDotMarkers(out)
	out = foldSpelledDigits(out)
	out = foldSpacedDigits(out)
	return out
}

// --- Deterministic detectors (contact exchange -> orange/review) ---

const EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+){0,3}\.[a-z]{2,}\b/gi

const DISCORD_INVITE =
	/\b(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+\b/gi

const URL_SCHEME = /\bhttps?:\/\/[^\s<>"']+/gi

const URL_WWW = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+){0,3}\.[a-z]{2,}\b/gi

// Deliberately not exhaustive — a short, curated list of TLDs common enough in
// player-facing links to be worth flagging. Kept short on purpose: every entry
// widens the bare-domain matcher's false-positive surface (any "word.word"
// with a listed suffix fires), so this is a precision/recall tradeoff, not an
// oversight. Easy to extend once shadow data shows misses.
const COMMON_TLDS = [
	'com',
	'net',
	'org',
	'io',
	'gg',
	'co',
	'wiki',
	'app',
	'dev',
	'me',
	'tv',
	'info',
	'biz',
	'xyz',
	'link',
	'edu',
	'gov',
	'us',
	'uk',
]

const URL_BARE = new RegExp(
	`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+){0,3}\\.(?:${COMMON_TLDS.join('|')})\\b`,
	'gi',
)

const IP =
	/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g

// "(555) 123-4567" — parenthesized area code, checked before the general run
// so its parens aren't left dangling in the plain digit-run match.
const PHONE_PAREN = /\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}\b/g

// Any 7+ digit run allowing space/dot/dash separators. Intentionally broad
// (per spec) — a bare 7+ digit number in chat (e.g. a large score) will also
// match; see the design-decision note in the PR description.
const PHONE_RUN = /\b\d(?:[\s.-]?\d){6,}\b/g

// "handle#1234" — Discord-style tag. Requires the literal discriminator
// suffix, so it never fires on a bare alphanumeric token (e.g. a Balatro seed
// like "ALEEB7AM" has no "#NNNN" suffix).
const DISCORD_TAG = /\b[a-z0-9_.]{2,32}#\d{4}\b/gi

// "@handle on discord/insta/snap/telegram/kik/whatsapp/signal"
const HANDLE_ON_PLATFORM =
	/@[a-z0-9_.]{2,32}\s+on\s+(?:discord|insta(?:gram)?|snap(?:chat)?|telegram|kik|whatsapp|signal)\b/gi

// "on discord: handle" / "on discord handle"
// The trailing `\b` right after the platform alternation is load-bearing: it
// forces the optional "chat"/"gram" suffixes to be consumed as part of the
// platform name (not left over for the alternation to "shortchange" so the
// handle-chars class can absorb them) — without it, "on snapchat" alone (no
// handle at all) matches with platform="snap" + handle="chat".
const ON_PLATFORM_HANDLE =
	/\bon\s+(?:discord|insta(?:gram)?|snap(?:chat)?|telegram|kik|whatsapp|signal)\b\s*[:-]?\s*[a-z0-9_.#]{2,37}\b/gi

// Priority order matters: it resolves overlap conflicts (e.g. an IP's digits
// would also shape-match the phone run; checking `ip` first consumes that
// span so `phone` never re-reports it). Earlier entries win ties.
export const CONTACT_PATTERNS: Array<{ kind: SafetyMatchKind; regex: RegExp }> =
	[
		{ kind: 'email', regex: EMAIL },
		{ kind: 'invite_link', regex: DISCORD_INVITE },
		{ kind: 'url', regex: URL_SCHEME },
		{ kind: 'url', regex: URL_WWW },
		{ kind: 'ip', regex: IP },
		{ kind: 'url', regex: URL_BARE },
		{ kind: 'phone', regex: PHONE_PAREN },
		{ kind: 'phone', regex: PHONE_RUN },
		{ kind: 'social_handle', regex: DISCORD_TAG },
		{ kind: 'social_handle', regex: HANDLE_ON_PLATFORM },
		{ kind: 'social_handle', regex: ON_PLATFORM_HANDLE },
	]

// --- Intent phrases (orange) ---
//
// Contact-solicitation / grooming-adjacent intent. Kept as a plain data array
// (pattern + label) so it's swappable for a DB-loaded list later without
// touching the detector.
export const INTENT_PHRASES: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /add me on\b/gi, label: 'add_me_on' },
	{ pattern: /\bdm me\b/gi, label: 'dm_me' },
	{ pattern: /message me on\b/gi, label: 'message_me_on' },
	{
		pattern:
			/what'?s your (?:discord|snap(?:chat)?|insta(?:gram)?|number|telegram)\b/gi,
		label: 'whats_your_contact',
	},
	{ pattern: /\bwhats ur\b/gi, label: 'whats_ur' },
	{
		pattern: /send\s+(?:me\s+)?(?:a\s+)?(?:pics?|photo)\b/gi,
		label: 'send_pic',
	},
	{ pattern: /how old are you\b/gi, label: 'how_old' },
	{ pattern: /where do you live\b/gi, label: 'where_live' },
	{ pattern: /what school\b/gi, label: 'what_school' },
	{ pattern: /are your parents\b/gi, label: 'parents' },
	{ pattern: /let'?s talk somewhere else\b/gi, label: 'talk_elsewhere' },
	{ pattern: /lets? move to\b/gi, label: 'move_to' },
	{ pattern: /off[\s-]?platform\b/gi, label: 'off_platform' },
]

function overlapsAny(
	start: number,
	end: number,
	accepted: SafetyMatch[],
): boolean {
	return accepted.some((a) => start < a.endIndex && a.startIndex < end)
}

function collect(
	text: string,
	regex: RegExp,
	kind: SafetyMatchKind,
	severity: SafetySeverity,
	pattern: string,
	accepted: SafetyMatch[],
): void {
	regex.lastIndex = 0
	let match: RegExpExecArray | null = regex.exec(text)
	while (match !== null) {
		const start = match.index
		const end = start + match[0].length
		if (match[0].length === 0) {
			regex.lastIndex += 1
			match = regex.exec(text)
			continue
		}
		if (!overlapsAny(start, end, accepted)) {
			accepted.push({
				kind,
				severity,
				span: match[0],
				startIndex: start,
				endIndex: end,
				pattern,
			})
		}
		match = regex.exec(text)
	}
}

/**
 * Detects PII / contact-exchange / doxxing signals in already-normalized
 * text. Total — never throws. Returned indices are positions in the
 * obfuscation-folded text (see `foldObfuscations`), not the raw input passed
 * by the caller, since folding can change string length (e.g. collapsing
 * spaced-out digits); callers that need to highlight the original span should
 * treat `span` as the authoritative matched text rather than re-slicing the
 * caller's original string by index.
 */
export function detectContactExchange(normalizedText: string): SafetyMatch[] {
	const folded = foldObfuscations(normalizedText)
	const matches: SafetyMatch[] = []

	// Contact exchange (sharing a Discord/handle/number) is `orange` = route to
	// review, not `red` = hard-block (policy 2026-07-09): in a co-op game this is
	// mostly players finding teammates, and the corpus showed it was the single
	// biggest source of false-positive friction (0.45% of all traffic). Orange
	// still publishes + flags for human audit, and the guard downstream can still
	// hard-block genuinely predatory contact (e.g. "how old are you" + a handle).
	for (const { kind, regex } of CONTACT_PATTERNS) {
		collect(folded, regex, kind, 'orange', regex.source, matches)
	}
	for (const { pattern, label } of INTENT_PHRASES) {
		collect(folded, pattern, 'intent_phrase', 'orange', label, matches)
	}

	return matches.sort((a, b) => a.startIndex - b.startIndex)
}
