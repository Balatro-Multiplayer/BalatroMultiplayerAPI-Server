import { buildRankQuery, buildRankDocument } from './rankSerialize.js'
import type { GuardTurn, GuardSafety } from './types.js'

// Track B guard: a fine-tuned Qwen3-Reranker-style yes/no model, served via
// node-llama-cpp's `createRankingContext()`. One forward pass, no
// autoregressive decode — this is what makes it fast relative to the
// text-generating guard in engine.ts. See rankSerialize.ts for the query/
// document format, which must exactly match what the model was trained on.

export type RankJudgement = {
	safety: GuardSafety
	score: number
	contextUsed: boolean
	latencyMs: number
}

export type RankEngine = {
	judge(target: string, context: GuardTurn[]): Promise<RankJudgement>
	ready(): boolean
	loadError?(): string | null
}

/** Minimal shape of node-llama-cpp's ranking context this module depends on. */
type RankingContext = {
	rank(query: string, document: string): Promise<number>
}

export type CreateRankGuardEngineOptions = {
	modelPath: string
	threads?: number
	/**
	 * Routing thresholds against the model's 0-1 yes-probability score:
	 * score < lowThreshold -> confidently Safe (no rerun needed)
	 * score > highThreshold -> confidently Unsafe
	 * otherwise -> ambiguous, escalate to a second pass with real context
	 *
	 * Chosen via threshold_sweep_summary.py against rank-model-v2's real
	 * validation scores, then confirmed against the held-out test split
	 * (not used for tuning): at lo=0.35/hi=0.8, no-context pass measured
	 * 3.7% Safe false-positive rate / 77.8% Unsafe recall on valid,
	 * 1.2% / 100% on test; with-context pass 2.6%/85.7% on valid, 1.4%/100%
	 * on test. The scores are strongly bimodal -- `lowThreshold` barely
	 * matters (moving it from 0.05 to 0.5 changed the outcome by <1%); the
	 * real lever is `highThreshold`, and 0.8 was the point where raising it
	 * further started trading away Unsafe recall for only marginal further
	 * false-positive reduction. Both Unsafe recall figures come from small
	 * samples (n=18-19 no-context, n=3-7 with-context) -- trust the shape
	 * (bimodal, hi>lo matters more) over the exact decimals.
	 */
	lowThreshold?: number
	highThreshold?: number
}

async function loadRankingContext(
	modelPath: string,
	threads: number,
): Promise<RankingContext> {
	const { getLlama } = await import('node-llama-cpp')
	const llama = await getLlama()
	const model = await llama.loadModel({ modelPath })
	if (!model.fileInsights.supportsRanking) {
		throw new Error(
			`model at ${modelPath} does not support ranking (supportsRanking=false) — ` +
				'was it converted from a directory named to trigger llama.cpp\'s ' +
				'qwen3-reranker detection? see conversion/qwen.py _is_qwen3_reranker()',
		)
	}
	return model.createRankingContext({ threads })
}

/**
 * Maps a final (possibly context-escalated) score to the same three-way
 * safety label decide.ts already knows how to route. A score that is STILL
 * ambiguous after the with-context rerun maps to 'Controversial' — decide.ts
 * already treats that as publish-plus-human-review, which is a safe interim
 * behavior. Whether "still ambiguous after context" should instead escalate
 * to engine.ts's generative model for a second opinion is an open product
 * decision (see the plan's Phase 7) — deliberately not decided here. If that
 * changes, the caller of `judge()` can distinguish this case via
 * `contextUsed === true` combined with `safety === 'Controversial'`.
 */
function scoreToSafety(
	score: number,
	lowThreshold: number,
	highThreshold: number,
): GuardSafety {
	if (score < lowThreshold) return 'Safe'
	if (score > highThreshold) return 'Unsafe'
	return 'Controversial'
}

export async function createRankGuardEngine(
	opts: CreateRankGuardEngineOptions,
): Promise<RankEngine> {
	const threads = opts.threads ?? 2
	const lowThreshold = opts.lowThreshold ?? 0.35
	const highThreshold = opts.highThreshold ?? 0.8

	let ranking: RankingContext | null = null
	let loadError: unknown = null
	try {
		ranking = await loadRankingContext(opts.modelPath, threads)
	} catch (err) {
		loadError = err
		ranking = null
	}

	const query = buildRankQuery()

	return {
		ready: () => ranking !== null,
		loadError: () => (loadError === null ? null : String(loadError)),

		async judge(target: string, context: GuardTurn[]): Promise<RankJudgement> {
			if (!ranking) {
				throw new Error(`rank engine not loaded: ${String(loadError)}`)
			}
			const start = performance.now()

			// Stage 1: cheap pass, no context.
			const noContextDoc = buildRankDocument(target, [])
			const firstScore = await ranking.rank(query, noContextDoc)
			const firstSafety = scoreToSafety(firstScore, lowThreshold, highThreshold)

			// No context to add (e.g. the first message in a lobby) -- a second
			// pass would just repeat the exact same call, so skip it regardless
			// of how ambiguous the first score was.
			if (firstSafety !== 'Controversial' || context.length === 0) {
				return {
					safety: firstSafety,
					score: firstScore,
					contextUsed: false,
					latencyMs: performance.now() - start,
				}
			}

			// Stage 2: ambiguous -- rerun with real context (the expensive path,
			// intended to be rare; see the plan's real with-context benchmark).
			const withContextDoc = buildRankDocument(target, context)
			const secondScore = await ranking.rank(query, withContextDoc)
			const secondSafety = scoreToSafety(secondScore, lowThreshold, highThreshold)

			return {
				safety: secondSafety,
				score: secondScore,
				contextUsed: true,
				latencyMs: performance.now() - start,
			}
		},
	}
}
