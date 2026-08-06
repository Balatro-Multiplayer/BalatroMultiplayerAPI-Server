// Where the guard model actually is. Pure: the caller does the filesystem
// poking and hands the results in, so every branch below is unit-testable.
//
// Why this exists: the guard is the ONLY model, and no usable guard verdict
// fails closed — so a model the service cannot find is not a degraded mode,
// it is total chat outage. Requiring an exact filename made that a trap (the
// tuned model is not named after the base model it came from), so GUARD_MODEL
// takes a DIRECTORY as well as a file: point it at a folder holding one
// .gguf and the name does not matter.

export type ConfiguredKind = 'file' | 'directory' | 'missing'

export type ModelResolution = {
	// The path to load, or undefined when GUARD_MODEL is unset.
	path: string | undefined
	// Operator-facing explanation, or undefined when the configured path was a
	// file and got used as-is. Always logged — a fallback must never be
	// invisible, and a refusal has to say what to do about it.
	note?: string
}

/**
 * @param configured  GUARD_MODEL, or undefined when unset.
 * @param kind  What `configured` points at on disk.
 * @param candidatePaths  Full paths of the files to choose between: the
 *   contents of `configured` when it is a directory, otherwise of the
 *   directory it lives in. Empty when that directory is missing/unreadable.
 */
export function chooseModelPath(
	configured: string | undefined,
	kind: ConfiguredKind,
	candidatePaths: readonly string[],
): ModelResolution {
	if (configured === undefined) return { path: undefined }
	if (kind === 'file') return { path: configured }

	const models = candidatePaths
		.filter((p) => p.toLowerCase().endsWith('.gguf'))
		.sort()

	// Exactly one model is unambiguous — whatever it is called, it is the one
	// the operator put there.
	if (models.length === 1) {
		const only = models[0] as string
		return {
			path: only,
			note:
				kind === 'directory'
					? `GUARD_MODEL ${configured} is a directory — loading the only .gguf in it: ${only}`
					: `GUARD_MODEL ${configured} does not exist; loading the only .gguf beside it instead: ${only}. Set GUARD_MODEL to that path to silence this.`,
		}
	}

	// Two or more is a real choice, and guessing could load a model nobody
	// meant to run. Keep the configured path so this still fails closed, but
	// name the candidates — that is the one thing needed to fix it.
	if (models.length > 1) {
		return {
			path: configured,
			note: `GUARD_MODEL ${configured} is not a model file and ${models.length} .gguf files are available (${models.join(', ')}) — refusing to guess. Set GUARD_MODEL to one of them.`,
		}
	}

	return {
		path: configured,
		// Deliberately does not claim what happens to chat: that depends on
		// enforcement mode, and the ENFORCEMENT banner line states it exactly.
		note: `no .gguf found at or beside GUARD_MODEL ${configured} — the guard cannot judge anything until a model is in place.`,
	}
}
