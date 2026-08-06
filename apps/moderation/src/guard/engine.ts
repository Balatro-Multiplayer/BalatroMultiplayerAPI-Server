import { availableParallelism } from 'node:os'
import { buildPrompt, parseGuardOutput } from './prompt.js'
import type { GuardSafety, GuardTurn } from './prompt.js'

// The context guard's injected seam (ws10). The heavy `node-llama-cpp` import
// is dynamic so this module is cheap to import (tests, other entrypoints) and
// so a load failure (missing native binary/model, e.g. in CI) is a caught
// state, not a crash.

export type GuardJudgement = {
	safety: GuardSafety
	categories: string[]
	latencyMs: number
	raw: string
}

export type GuardEngine = {
	judge(turns: GuardTurn[]): Promise<GuardJudgement>
	ready(): boolean
	/**
	 * The caught reason `ready()` is false (missing native binary, bad model
	 * path, OOM, ...), or `null` once loaded. Optional so existing test
	 * doubles need not implement it; main.ts logs it and /health surfaces it —
	 * "guard failed to load" with no reason is an hour of guessing instead of
	 * a five-second fix.
	 */
	loadError?(): string | null
}

/** Minimal shape of node-llama-cpp's `LlamaCompletion` this module depends on. */
type CompletionEngine = {
	generateCompletion(
		prompt: string,
		opts: {
			maxTokens: number
			temperature: number
			customStopTriggers: string[]
		},
	): Promise<string>
}

export type CreateLlamaGuardEngineOptions = {
	modelPath: string
	maxTokens?: number
	temperature?: number
	/**
	 * ggml worker thread count. MUST NOT exceed the cores actually available:
	 * ggml threads spin-wait, so oversubscription doesn't degrade gracefully —
	 * it collapses (measured 20-40s/judgement vs ~2s on the same 2-core host).
	 * Defaults to `availableParallelism()`, which reads the host's cores; in a
	 * cpu-quota'd container set GUARD_THREADS to the quota instead.
	 */
	threads?: number
	/**
	 * Human-edited game-vocabulary notes (already parsed via
	 * `parseDomainContext`), injected into every prompt. Teaches the guard the
	 * game's slang ("white stake" = difficulty, not race) so in-domain banter
	 * stops false-flagging — measured to leave real-harm verdicts unchanged.
	 */
	domainContext?: string
}

// NOTE on prefix caching (do not re-attempt without new evidence): manually
// pre-evaluating the constant prompt prefix into the KV cache and rewinding
// per judgement (evaluateWithoutGeneratingNewTokens + eraseContextTokenRanges)
// was built and measured 2026-07-07 against the plain generateCompletion path
// — it was SLOWER on both backends (GPU Vulkan: 187ms vs 119ms/msg; CPU:
// 5800ms vs 5110ms/msg; verdicts identical). node-llama-cpp's high-level path
// is already near-optimal here. The cheap lever for prompt cost is keeping
// guard-context.txt terse (every token is per-judgement prefill).

async function loadRealCompletionEngine(
	modelPath: string,
	threads: number,
): Promise<CompletionEngine> {
	const { getLlama, LlamaCompletion } = await import('node-llama-cpp')
	const llama = await getLlama()
	const model = await llama.loadModel({ modelPath })
	const context = await model.createContext({ threads })
	const sequence = context.getSequence()
	return new LlamaCompletion({ contextSequence: sequence })
}

/**
 * Builds the real llama.cpp-backed guard engine. Loading is attempted once;
 * a failure (no native binary, missing model file, OOM, ...) leaves the
 * engine `ready()===false`. This is FAIL CLOSED, not fail-open: /health then
 * reports not-ready, POST /moderate 503s (server.ts), and the relay fails
 * closed on that 503 per its own outage policy — every non-deterministic
 * message is rejected while the guard is down (decide.ts's `guard_unavailable`
 * floor). A down guard is a total chat outage, not "less auto-resolution".
 * `loadError()` carries the caught reason so main.ts and /health can say why.
 */
export async function createLlamaGuardEngine(
	opts: CreateLlamaGuardEngineOptions,
): Promise<GuardEngine> {
	const maxTokens = opts.maxTokens ?? 48
	const temperature = opts.temperature ?? 0
	const threads = opts.threads ?? Math.max(1, availableParallelism())
	const domainContext = opts.domainContext

	let completion: CompletionEngine | null = null
	let loadError: unknown = null
	try {
		completion = await loadRealCompletionEngine(opts.modelPath, threads)
	} catch (err) {
		loadError = err
		completion = null
	}

	return {
		ready: () => completion !== null,
		loadError: () => (loadError === null ? null : String(loadError)),

		async judge(turns: GuardTurn[]): Promise<GuardJudgement> {
			if (!completion) {
				throw new Error(`guard engine not loaded: ${String(loadError)}`)
			}
			const start = performance.now()
			const raw = await completion.generateCompletion(
				buildPrompt(turns, domainContext),
				{
					maxTokens,
					temperature,
					customStopTriggers: ['<|im_end|>'],
				},
			)
			const latencyMs = performance.now() - start
			const parsed = parseGuardOutput(raw)
			return { ...parsed, latencyMs, raw }
		},
	}
}

/**
 * Deterministic test double, keyed by the last USER turn's exact text. Any
 * unscripted message resolves to `unknown` (matching the real engine's
 * malformed-output fallback) rather than throwing, so tests can exercise the
 * "leave pending" path without pre-scripting every message.
 */
export function createFakeGuardEngine(
	scripted: Record<string, { safety: GuardSafety; categories: string[] }>,
): GuardEngine {
	return {
		ready: () => true,
		loadError: () => null,
		async judge(turns: GuardTurn[]): Promise<GuardJudgement> {
			const last = turns[turns.length - 1]
			const hit = last ? scripted[last.text] : undefined
			if (!hit)
				return { safety: 'unknown', categories: [], latencyMs: 0, raw: '' }
			return {
				safety: hit.safety,
				categories: hit.categories,
				latencyMs: 0,
				raw: `Safety: ${hit.safety}\nCategories: ${hit.categories.join(', ') || 'None'}`,
			}
		},
	}
}
