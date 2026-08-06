import type { GuardEngine } from '../guard/engine.js'
import { createDeterministicAnalyzer } from '../pipeline/analyze.js'
import { decideModeration } from '../pipeline/decide.js'
import { stripLinks } from '../pipeline/links.js'
import { capForScoring, normalizeForAllowlist } from '../pipeline/normalize.js'
import { DEFAULT_POLICY } from '../pipeline/policy.js'
import { type RewriteRule, applyRewrites } from '../pipeline/rewrite.js'
import type {
	Decision,
	GuardInput,
	ModerationPolicy,
	TokenBucket,
} from '../pipeline/types.js'
import {
	type AdmissionController,
	createAdmissionController,
} from './admission.js'

// The moderation service core: composes the analyzer, the guard engine,
// per-player rate-limit state, and the pure decision core behind one
// `moderate()` call. Qwen3Guard is the ONLY model — its judgement runs INSIDE
// /moderate (real-time gate) under a deadline; a judgement that can't land in
// time fails open on the guard's own answer but CLOSED on the decision (band
// `guard_unavailable`, nothing published). Transport (HTTP) lives in
// server.ts; this module is testable without sockets.
//
// STATELESS AND VERDICT-ONLY: message in, verdict out. There is no database on
// this path, no audit trail, no admin surface — see docs/13 for what else this
// system could be (Standing lives on a separate branch/deployable). The JSONL
// line handed to `onVerdict` is the only record this service produces.

export type ModerateRequest = {
	playerId: string
	lobbyCode: string
	message: string
}

export type ModerateResponse = {
	verdict: 'allow' | 'reject'
	band: Decision['band'] | 'shed'
	reason?: string
	/**
	 * Present when the transform tier changed the text — an unapproved link
	 * stripped to "[link removed]" and/or a community-vocabulary rewrite
	 * ("cock" → "cocktail"). On allow, the relay MUST publish this instead of the
	 * original — the transformed form is what was judged.
	 */
	publishText?: string
	latency_ms: number
}

export type ModerationServiceOptions = {
	/** The judge. Real llama.cpp engine in production, fake in tests. */
	guard: GuardEngine
	policy?: ModerationPolicy
	allowlist?: Set<string>
	/**
	 * Deterministic community-vocabulary rewrites (REWRITES_PATH), applied to
	 * the message before every other tier. The rewritten text is what gets
	 * judged and (via `publishText`) published.
	 */
	rewrites?: readonly RewriteRule[]
	/**
	 * Approved link domains (APPROVED_DOMAINS_PATH). Any URL whose domain is not
	 * in this set is replaced with a placeholder before every other tier — see
	 * pipeline/links.ts. Empty (the default) strips ALL links.
	 */
	approvedDomains?: readonly string[]
	admission?: AdmissionController
	clock?: () => number
	/** Receives every decision for audit (JSONL to stdout in production). */
	onVerdict?: (entry: Record<string, unknown>) => void
}

/** Diagnostic snapshot for GET /health — never read by, or fed back into, a decision. */
export type ModerationServiceDiagnostics = {
	modelLoadError: string | null
	guardInflight: number
	guardAvgJudgeMs: number | null
}

export type ModerationService = {
	moderate(req: ModerateRequest): Promise<ModerateResponse>
	ready(): boolean
	diagnostics(): ModerationServiceDiagnostics
}

/**
 * Pure: can a newly-arriving judgement still make its deadline given the
 * lane's current occupancy and how long judgements have been taking? Unknown
 * speed (no completed judgement yet) is optimistic — the deadline race is the
 * backstop either way.
 */
export function canMeetDeadline(
	laneDepth: number,
	avgJudgeMs: number | null,
	deadlineMs: number,
): boolean {
	if (!deadlineMs || deadlineMs <= 0) return true
	if (avgJudgeMs === null) return true
	return (laneDepth + 1) * avgJudgeMs <= deadlineMs
}

export type JudgeLane = {
	/** Judge `text` as plain data — never throws, `{skipped}` on any miss. */
	judge(text: string, deadlineMs: number): Promise<GuardInput>
	/** Judgements currently occupying the lane (running or abandoned-but-running). */
	depth(): number
	/** EMA of completed judgement latency in ms, `null` before the first one lands. */
	avgJudgeMs(): number | null
}

/**
 * Wraps the guard engine in a single stateful "lane": it knows how many
 * judgements are in flight and how long they take (EMA), so a message that
 * mathematically cannot make its deadline is rejected IMMEDIATELY
 * (`{skipped: 'backlog'}`) instead of burning the full deadline first —
 * fail-closed overload feels instant, not slow. Deadline hit / engine failure
 * / engine not loaded all come back as `{skipped}` too. A judgement that
 * outlives its deadline still completes inside the engine (its llama sequence
 * stays busy), so it keeps counting toward depth until it truly finishes.
 */
export function createJudgeLane(engine: GuardEngine): JudgeLane {
	let inflight = 0
	let avgJudgeMs: number | null = null
	const EMA_ALPHA = 0.3

	return {
		depth: () => inflight,
		avgJudgeMs: () => avgJudgeMs,

		async judge(text: string, deadlineMs: number): Promise<GuardInput> {
			if (!engine.ready()) return { skipped: 'engine_not_ready' }
			// Backlog short-circuit ONLY when queued behind someone. An empty lane
			// always attempts: the deadline race bounds the wait regardless, and
			// each completed judgement refreshes the EMA — without this, one slow
			// cold-start judgement teaches the EMA "too slow" and the lane locks
			// itself out forever (observed live: idle lane, instant rejects).
			if (inflight > 0 && !canMeetDeadline(inflight, avgJudgeMs, deadlineMs)) {
				return { skipped: 'backlog' }
			}

			inflight++
			const started = performance.now()
			const judgement = engine
				.judge([{ who: 'sender', text }])
				.then((j): GuardInput => {
					const took = performance.now() - started
					avgJudgeMs =
						avgJudgeMs === null
							? took
							: avgJudgeMs + EMA_ALPHA * (took - avgJudgeMs)
					return { safety: j.safety, categories: j.categories }
				})
				.catch((): GuardInput => ({ skipped: 'engine_error' }))
				.finally(() => {
					inflight--
				})
			if (!deadlineMs || deadlineMs <= 0) return judgement

			let timer: ReturnType<typeof setTimeout> | undefined
			const deadline = new Promise<GuardInput>((resolve) => {
				timer = setTimeout(() => resolve({ skipped: 'deadline' }), deadlineMs)
			})
			const result = await Promise.race([judgement, deadline])
			clearTimeout(timer)
			return result
		},
	}
}

export function createModerationService(
	opts: ModerationServiceOptions,
): ModerationService {
	const policy = opts.policy ?? DEFAULT_POLICY
	const allowlist = opts.allowlist ?? new Set<string>()
	const admission = opts.admission ?? createAdmissionController()
	const clock = opts.clock ?? (() => Date.now())
	const onVerdict = opts.onVerdict ?? (() => {})
	const analyzer = createDeterministicAnalyzer({
		approvedDomains: opts.approvedDomains ?? [],
	})
	const lane = createJudgeLane(opts.guard)

	// No per-player state at all: nothing about a player is remembered between
	// requests, so two instances judge the same message identically and a
	// restart changes nothing. Per-player rate limiting lives in the relay's
	// chat route (same budget, applied earlier); this service protects itself
	// with the global ingress valve and the guard lane's backlog shedding.

	/** The capped text the guard actually reads (deterministic tiers saw it all). */
	const guardText = (message: string): string =>
		capForScoring([message], policy.scoreMaxChars)[0] ?? message

	const rewrites = opts.rewrites ?? []
	const approvedDomains = opts.approvedDomains ?? []
	// Deterministic pre-judge transform: strip unapproved links, then apply
	// community rewrites. Links go first so an approved URL is never mangled by
	// a word rewrite. The result is what every tier judges AND what is published.
	const transform = (raw: string): string =>
		applyRewrites(stripLinks(raw, approvedDomains), rewrites)

	return {
		ready: () => opts.guard.ready(),
		diagnostics: () => ({
			modelLoadError: opts.guard.loadError?.() ?? null,
			guardInflight: lane.depth(),
			guardAvgJudgeMs: lane.avgJudgeMs(),
		}),

		async moderate(req: ModerateRequest): Promise<ModerateResponse> {
			const started = clock()

			if (!admission.admit(started)) {
				return {
					verdict: 'reject',
					band: 'shed',
					reason: 'service_overloaded',
					latency_ms: clock() - started,
				}
			}

			// Transform tier first: strip unapproved links, then community-vocabulary
			// rewrites. The transformed text is what every tier judges and what gets
			// published (publishText).
			const text = transform(req.message)

			const normalized = normalizeForAllowlist(text)
			if (normalized === null) {
				return {
					verdict: 'reject',
					band: 'clean',
					reason: 'empty',
					latency_ms: clock() - started,
				}
			}

			const evidence = analyzer.analyze(text)
			const isAllowlisted = allowlist.has(normalized)

			// Skip the guard when a cheaper tier already decides the outcome. When
			// we do judge, cap the input length (the deterministic scan above
			// already saw the FULL message — only the LLM's cost is bounded here).
			const deterministicOutcome =
				isAllowlisted ||
				evidence.threatMatches.length > 0 ||
				evidence.obscenityMatches.length > 0 ||
				evidence.safetySignals.some((s) => s.severity === 'red')

			// An explicit skip marker, never a bare null: decideModeration's
			// fail-closed branch keys off `{skipped}`, so anything other than a
			// real verdict rejects instead of silently allowing.
			const guard: GuardInput = deterministicOutcome
				? { skipped: 'deterministic' }
				: await lane.judge(guardText(text), policy.guardDeadlineMs)

			const decision = decideModeration({
				message: text,
				nowMs: started,
				isAllowlisted,
				threatMatches: evidence.threatMatches,
				obscenityMatches: evidence.obscenityMatches,
				safetySignals: evidence.safetySignals,
				guard,
				policy,
			})

			const latency_ms = clock() - started
			const v = decision.verdict
			// Operational telemetry only — NO message content, and no matched
			// WORDS either (obscenity/threat matches carry the literal matched
			// text; only their counts are safe to log). `rewritten` flags that a
			// rewrite happened without logging either form. `wouldHaveBlocked` +
			// the guard fields are the whole point of shadow mode: without them a
			// shadow would-block and a genuine Controversial review are
			// indistinguishable in this stream, and EVAL.md's daily
			// wouldHaveBlocked pull has nothing to pull from.
			onVerdict({
				ts: new Date(started).toISOString(),
				playerId: req.playerId,
				lobbyCode: req.lobbyCode,
				decision: decision.decision,
				band: decision.band,
				rewritten: text !== req.message,
				allowlisted: v.allowlisted,
				wouldHaveBlocked: v.wouldHaveBlocked ?? false,
				guardSafety: v.guardSafety,
				guardCategories: v.guardCategories,
				guardSkipped: v.guardSkipped,
				threatMatchCount: v.threatMatches?.length ?? 0,
				obscenityMatchCount: v.obscenityMatches?.length ?? 0,
				safetySignalCount: v.safetySignals?.length ?? 0,
				latency_ms,
			})

			const response: ModerateResponse = {
				verdict: decision.decision,
				band: decision.band,
				latency_ms,
			}
			if (text !== req.message) {
				response.publishText = text
			}
			if (decision.decision === 'reject') {
				response.reason = decision.band
			}
			return response
		},
	}
}
