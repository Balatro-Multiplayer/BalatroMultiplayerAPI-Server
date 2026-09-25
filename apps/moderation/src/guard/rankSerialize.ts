// Query/document serialization for the Track B single-score classifier (a fine-tuned
// Qwen3-Reranker-style yes/no model, served via node-llama-cpp's LlamaRankingContext).
// Reused verbatim for both training-data export and production inference, the same way
// prompt.ts's buildPrompt() is reused for the generative model — train/inference formatting
// must never drift out of sync.

import type { GuardTurn } from './types.js'

/**
 * Fixed, short stand-in for the old policy prompt. Unlike the generative model, the task
 * definition mostly lives in the fine-tuned weights, not in per-request instruction text —
 * this only needs to disambiguate the (fixed) rerank template's generic "Instruct" boilerplate
 * ("Given a web search query, retrieve relevant passages...", baked into the GGUF by
 * llama.cpp's conversion and not itself customizable) toward our actual task.
 */
export function buildRankQuery(): string {
	return 'Is this chat message unsafe, harmful, or against community guidelines?'
}

/**
 * Context turns oldest-first as OTHER:/SENDER:, then an unambiguous MESSAGE: line for the
 * target being judged. Deliberately NOT reusing "SENDER:" for the target line — the sender
 * may also have earlier turns tagged SENDER: in the context, and the model needs an
 * unambiguous signal for which line is actually being scored.
 */
export function buildRankDocument(target: string, context: GuardTurn[]): string {
	const lines = context.map(
		(t) => `${t.who === 'sender' ? 'SENDER' : 'OTHER'}: ${t.text}`,
	)
	lines.push(`MESSAGE: ${target}`)
	return lines.join('\n')
}
