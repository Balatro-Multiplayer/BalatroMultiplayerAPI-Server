// Qwen3Guard-Gen-0.6B prompt template (ws10 context guard, P6 prototype:
// admin-local/moderation-proto/p6-guard.mjs). This is the model's EXACT
// trained chat template — the community GGUF's generic wrapper produces
// garbage without it, so HEADER/FOOTER must not be "cleaned up" or reflowed.
//
// Two-player mapping: the message SENDER being judged = USER turns, their
// opponent = ASSISTANT turns. The guard assesses ONLY the last USER message,
// which is exactly the banter-vs-targeting question this tier exists to answer.

export type GuardSafety = 'Safe' | 'Unsafe' | 'Controversial' | 'unknown'

export type GuardTurn = { who: 'sender' | 'other'; text: string }

export type GuardVerdict = { safety: GuardSafety; categories: string[] }

export const HEADER = `<|im_start|>user
# Task:
1) Evaluate whether THE LAST USER's query belongs to safe or unsafe content based on our safety policy.
2) Identify the category of unsafe content found.

<BEGIN SAFETY POLICY>
**Safety: Safe**: The USER's query does not contain any prohibited content or content that could lead to prohibited content.
**Safety: Unsafe**: The USER's query contains prohibited content.
**Safety: Controversial**: The USER's query does not explicitly contain prohibited content, but its intent, context, or potential responses could be misinterpreted, misused, or exploited to generate unsafe content under certain conditions.
<END SAFETY POLICY>

<BEGIN UNSAFE CONTENT CATEGORIES>
Violent.
Non-violent Illegal Acts.
Sexual Content or Sexual Acts.
PII.
Suicide & Self-Harm.
Unethical Acts.
Politically Sensitive Topics.
Copyright Violation.
Jailbreak.
<END UNSAFE CONTENT CATEGORIES>

<BEGIN CONVERSATION>

`

export const FOOTER = `

<END CONVERSATION>

Provide your safety assessment for ONLY THE LAST **USER's query** in the above conversation:
 - The first line must be one of: 'Safety: Safe', 'Safety: Unsafe', 'Safety: Controversial'.
 - The second line should start with 'Categories:' followed by a list of any unsafe content categories, separated by commas. If the content is safe, use 'Categories: None'.<|im_end|>
<|im_start|>assistant
<think>

</think>

`

/**
 * Parses a human-edited domain-context file (GUARD_CONTEXT_PATH): plain
 * statements about the game's vocabulary, one concern per line. Lines starting
 * with `#` are editor comments and are stripped; everything else is injected
 * into the prompt verbatim. Empty/whitespace-only input yields ''.
 */
export function parseDomainContext(text: string): string {
	return text
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n')
		.trim()
}

/**
 * The constant prompt prefix: the trained header with the optional domain
 * context injected at the top of the user turn, before the task/policy. Every
 * prompt this module builds starts with exactly this string — which is what
 * makes engine-level prefix caching sound (the KV state for these tokens can
 * be computed once and reused for every judgement).
 */
export function buildPromptPrefix(domainContext?: string): string {
	const ctx = domainContext?.trim()
		? `<GAME CONTEXT>\n${domainContext.trim()}\n</GAME CONTEXT>\n\n`
		: ''
	return ctx
		? HEADER.replace('<|im_start|>user\n', `<|im_start|>user\n${ctx}`)
		: HEADER
}

/**
 * turns: last turn must be the sender — the guard only judges that one.
 *
 * domainContext (optional): game-vocabulary notes injected at the top of the
 * user message, before the task/policy. Measured effect (2026-07-07, 0.6B Q8):
 * flips game-speak false positives ("white stake fine?" Controversial→Safe)
 * while leaving every real-harm verdict unchanged.
 */
export function buildPrompt(
	turns: GuardTurn[],
	domainContext?: string,
): string {
	const convo = turns
		.map((t) => `${t.who === 'sender' ? 'USER' : 'ASSISTANT'}: ${t.text}`)
		.join('\n')
	return buildPromptPrefix(domainContext) + convo + FOOTER
}

const SAFE_RE = /Safety: (Safe|Unsafe|Controversial)/
const CAT_RE =
	/(Violent|Non-violent Illegal Acts|Sexual Content or Sexual Acts|PII|Suicide & Self-Harm|Unethical Acts|Politically Sensitive Topics|Copyright Violation|Jailbreak|None)/g

/** Parses the model's raw completion. Malformed/unrecognized output -> 'unknown'. */
export function parseGuardOutput(raw: string): GuardVerdict {
	const safety =
		(SAFE_RE.exec(raw)?.[1] as GuardSafety | undefined) ?? 'unknown'
	const categories = [...new Set(raw.match(CAT_RE) ?? [])].filter(
		(c) => c !== 'None',
	)
	return { safety, categories }
}
