import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRankGuardEngine } from './guard/rankEngine.js'
import { GUARD_JUDGED_PROFANITY } from './pipeline/analyze.js'
import { postureBannerLines } from './service/posture.js'
import type { ServicePosture } from './service/posture.js'
import { chooseModelPath } from './service/model-path.js'
import type { ConfiguredKind } from './service/model-path.js'
import type { ListStatus } from './service/server.js'
import { createModerationServer } from './service/server.js'
import { createModerationService } from './service/service.js'

// Entrypoint: load the guard, then serve. The rank guard (a fine-tuned,
// single-forward-pass classifier — no autoregressive decode, ~7x faster than
// the generative model it replaced) is the only model — it judges INSIDE
// /moderate (real-time gate, deadline-valved). Verdicts stream to stdout as
// JSONL — that line is the only record this service produces. /moderate is
// stateless: no database, no admin API, no review queue. See docs/13 for the
// fuller design (Standing/the sanctions ladder is a separate deployable, not
// part of this branch).

// The word lists ship with the service. An explicit *_PATH still wins, so a
// deployment can point at its own copies, but the common case needs no
// configuration at all — and nobody has to remember to copy files onto a box.
const BUNDLED_CONFIG_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../config',
)

function listPath(envVar: string, filename: string): string | undefined {
	const override = process.env[envVar]
	if (override) return override
	const bundled = path.join(BUNDLED_CONFIG_DIR, filename)
	return existsSync(bundled) ? bundled : undefined
}

const ALLOWLIST_PATH = listPath('ALLOWLIST_PATH', 'allowlist.txt')
const REWRITES_PATH = listPath('REWRITES_PATH', 'rewrites.txt')
const APPROVED_DOMAINS_PATH = listPath(
	'APPROVED_DOMAINS_PATH',
	'approved-domains.txt',
)

const PORT = Number(process.env.PORT ?? 8001)

// A model the service cannot find is total chat outage, not a degraded mode
// (no usable guard verdict fails closed), so GUARD_MODEL accepts a DIRECTORY
// as well as a file — the shipped default is the folder, which means nobody
// has to match a filename. This only pokes the filesystem; the choosing is in
// ./service/model-path.ts.
const GUARD_MODEL = ((): string | undefined => {
	const configured = process.env.GUARD_MODEL
	if (configured === undefined) return undefined

	let kind: ConfiguredKind = 'missing'
	if (existsSync(configured)) {
		kind = statSync(configured).isDirectory() ? 'directory' : 'file'
	}
	// A file is used as-is, so only the other two cases need a listing: the
	// directory itself, else the one the configured path lives in.
	const searchDir = kind === 'directory' ? configured : path.dirname(configured)
	let candidates: string[] = []
	if (kind !== 'file') {
		try {
			candidates = readdirSync(searchDir).map((name) =>
				path.join(searchDir, name),
			)
		} catch {
			// Missing/unreadable — chooseModelPath reports that as "no model
			// found", which is exactly right.
		}
	}

	const { path: resolved, note } = chooseModelPath(configured, kind, candidates)
	if (note) console.error(`[moderation] ${note}`)
	return resolved
})()

// Parse before validating: a raw-string presence check (`if (!BEARER)`) passes
// for ' ' or ',' — both truthy, both plausible from a hand-edited .env — which
// then resolve to zero usable tokens. Validate the PARSED list, never the raw
// env var, so a blank-but-truthy token can't silently disable auth in prod.
const bearerTokens = (process.env.MODERATION_BEARER_TOKEN ?? '')
	.split(',')
	.map((t) => t.trim())
	.filter(Boolean)

if (bearerTokens.length === 0) {
	// Not fatal any more. This service publishes no host port: it is reached
	// only by the relay over an internal network, so the token protects
	// nothing a network boundary is not already protecting. It stays supported
	// for anyone who does expose it - hence the warning rather than silence.
	console.error(
		'[moderation] no MODERATION_BEARER_TOKEN set — anything that can reach this port can request a verdict. Fine while the port is internal; set a token before exposing it.',
	)
}
if (!GUARD_MODEL) {
	console.error(
		'[moderation] GUARD_MODEL is not set — the guard is the only model; serving 503s (fail-closed) until it is configured',
	)
}

// MODERATION_REQUIRE_LISTS=1: turn a configured-but-unreadable word-list path
// into a startup failure instead of a silent degrade. Opt-in (default off) —
// existing deploys keep today's fail-open-and-continue behavior unless an
// operator asks for the stricter one. DEPLOY.md already documents these paths
// as drift-prone (host files, not synced by the deploy).
const REQUIRE_LISTS = process.env.MODERATION_REQUIRE_LISTS === '1'
function failIfListsRequired(envVar: string, err: unknown): void {
	if (!REQUIRE_LISTS) return
	console.error(
		`[moderation] MODERATION_REQUIRE_LISTS=1 and ${envVar} failed to load (${String(err)}) — refusing to boot on drifted config`,
	)
	process.exit(1)
}

// Explicit thread override for cpu-quota'd containers, where the host core
// count exceeds the quota and ggml's spin-wait threads would thrash (see
// CreateRankGuardEngineOptions.threads). Defaults to 2 inside rankEngine.ts —
// a lane-sizing benchmark for this specific model's cost profile (much
// cheaper per call than the generative model it replaced) is a worthwhile
// follow-up, not yet done.
const GUARD_THREADS = process.env.GUARD_THREADS
	? Number(process.env.GUARD_THREADS)
	: undefined

// Routing thresholds against the guard's 0-1 score (see rankEngine.ts):
// score < low -> confidently Safe, score > high -> confidently Unsafe,
// otherwise ambiguous (escalate to a real-context rescore). 0.35/0.8 were
// chosen via a threshold sweep against real validation + held-out test data
// (see threshold_sweep_summary.py) — exposed as env vars, like GUARD_THREADS,
// so they can be retuned without a redeploy of code.
const GUARD_LOW_THRESHOLD = process.env.GUARD_LOW_THRESHOLD
	? Number(process.env.GUARD_LOW_THRESHOLD)
	: undefined
const GUARD_HIGH_THRESHOLD = process.env.GUARD_HIGH_THRESHOLD
	? Number(process.env.GUARD_HIGH_THRESHOLD)
	: undefined

// Deterministic community-vocabulary rewrites (REWRITES_PATH): applied before
// every other tier; the rewritten text is judged and published. See
// pipeline/rewrite.ts for why this exists (guard can't be taught past some
// game abbreviations even with domain context).
let rewrites: import('./pipeline/rewrite.js').RewriteRule[] = []
let rewritesStatus: ListStatus = 'unset'
if (REWRITES_PATH) {
	const { readFileSync } = await import('node:fs')
	const { parseRewrites } = await import('./pipeline/rewrite.js')
	try {
		rewrites = parseRewrites(readFileSync(REWRITES_PATH, 'utf8'))
		rewritesStatus = rewrites.length
		console.error(`[moderation] rewrites loaded: ${rewrites.length} rules`)
		if (rewrites.length === 0) {
			console.error(
				'[moderation] WARNING: REWRITES_PATH parsed to zero rules — check the file is not empty or misformatted',
			)
		}
	} catch (err) {
		rewritesStatus = 'error'
		console.error(
			`[moderation] failed to read REWRITES_PATH (${String(err)}) — continuing without rewrites`,
		)
		failIfListsRequired('REWRITES_PATH', err)
	}
}

// Approved link domains (APPROVED_DOMAINS_PATH): any URL whose domain is not
// listed is replaced with a placeholder before judging/publishing. Empty or
// unset = strip ALL links (Balatro chat renders no images; see pipeline/links).
let approvedDomains: string[] = []
let approvedDomainsStatus: ListStatus = 'unset'
if (APPROVED_DOMAINS_PATH) {
	const { readFileSync } = await import('node:fs')
	const { parseApprovedDomains } = await import('./pipeline/links.js')
	try {
		approvedDomains = parseApprovedDomains(
			readFileSync(APPROVED_DOMAINS_PATH, 'utf8'),
		)
		approvedDomainsStatus = approvedDomains.length
		console.error(
			`[moderation] approved link domains loaded: ${approvedDomains.length}`,
		)
		if (approvedDomains.length === 0) {
			console.error(
				'[moderation] WARNING: APPROVED_DOMAINS_PATH parsed to zero domains — check the file is not empty or misformatted (this strips ALL links, same as leaving the path unset)',
			)
		}
	} catch (err) {
		approvedDomainsStatus = 'error'
		console.error(
			`[moderation] failed to read APPROVED_DOMAINS_PATH (${String(err)}) — stripping all links`,
		)
		failIfListsRequired('APPROVED_DOMAINS_PATH', err)
	}
}

console.error(`[moderation] loading guard ${GUARD_MODEL ?? '(unset)'}...`)
const guard = await createRankGuardEngine({
	modelPath: GUARD_MODEL ?? '/nonexistent',
	...(GUARD_THREADS !== undefined ? { threads: GUARD_THREADS } : {}),
	...(GUARD_LOW_THRESHOLD !== undefined
		? { lowThreshold: GUARD_LOW_THRESHOLD }
		: {}),
	...(GUARD_HIGH_THRESHOLD !== undefined
		? { highThreshold: GUARD_HIGH_THRESHOLD }
		: {}),
})
if (guard.ready()) {
	// rankEngine.ts defaults threads to 2 (not availableParallelism() — that
	// was the old generative engine's default, tuned for a much more
	// expensive per-call cost profile).
	console.error(`[moderation] guard ready (threads=${GUARD_THREADS ?? 2})`)
} else {
	// A bare "guard failed to load" is an hour of guessing (missing GGUF? wrong
	// path? OOM? missing native binary? corrupt file?); the resolved path plus
	// an existsSync/size check plus the caught reason turns it into a
	// five-second fix. This is a total chat outage (the relay fails closed on
	// the resulting 503s), so it is the failure mode most in need of a reason.
	const { existsSync, statSync } = await import('node:fs')
	const modelExists = GUARD_MODEL !== undefined && existsSync(GUARD_MODEL)
	const modelSizeBytes = modelExists
		? statSync(GUARD_MODEL as string).size
		: undefined
	console.error(
		[
			'[moderation] guard failed to load; serving 503s (fail-closed).',
			`model=${GUARD_MODEL ?? '(unset)'}`,
			`exists=${modelExists}`,
			...(modelSizeBytes !== undefined ? [`size_bytes=${modelSizeBytes}`] : []),
			`reason=${guard.loadError?.() ?? 'unknown'}`,
		].join(' '),
	)
}

// Global ingress admission (self-protection): defaults suit BMP volume; tune
// per deploy without a rebuild.
const { createAdmissionController } = await import('./service/admission.js')
const INGRESS_BURST = Number(process.env.MODERATION_INGRESS_BURST ?? '50')
const INGRESS_RATE = Number(process.env.MODERATION_INGRESS_RATE ?? '25')

// Shadow-mode override (SHADOW_MODE=0/false to enforce): the policy ships with
// shadowMode ON (guard-blocks published + logged as would-block, ADR-4); this
// is the deploy-time switch that flips enforcement on without a rebuild.
const SHADOW_MODE = !['0', 'false', 'off'].includes(
	(process.env.SHADOW_MODE ?? '').toLowerCase(),
)

// Posture must be unmissable in both directions — shadow mode (a net
// loosening vs a stock deployment, see GUARD_JUDGED_PROFANITY) is exactly the
// state most likely to be silently defaulted into, so it gets the loudest
// banner, not the quietest. The same fields back GET /health (server.ts).
const posture: ServicePosture = {
	enforcement: SHADOW_MODE ? 'shadow' : 'enforce',
	authEnabled: bearerTokens.length > 0,
}
for (const line of postureBannerLines(posture, GUARD_JUDGED_PROFANITY.size)) {
	console.error(line)
}

// Tier-0 fast-pass: the data-derived allowlist (see gen-allowlist). Optional —
// without it every non-deterministic message pays a guard judgement.
let allowlist: Set<string> | undefined
let allowlistStatus: ListStatus = 'unset'
if (ALLOWLIST_PATH) {
	const { readFileSync } = await import('node:fs')
	const { parseAllowlist } = await import('./service/allowlist.js')
	try {
		allowlist = parseAllowlist(readFileSync(ALLOWLIST_PATH, 'utf8'))
		allowlistStatus = allowlist.size
		console.error(`[moderation] allowlist loaded: ${allowlist.size} entries`)
		if (allowlist.size === 0) {
			console.error(
				'[moderation] WARNING: ALLOWLIST_PATH parsed to zero entries — check the file is not empty or misformatted (every message now pays a guard judgement)',
			)
		}
	} catch (err) {
		allowlistStatus = 'error'
		console.error(
			`[moderation] failed to read ALLOWLIST_PATH (${String(err)}) — continuing without an allowlist`,
		)
		failIfListsRequired('ALLOWLIST_PATH', err)
	}
}

const { DEFAULT_POLICY } = await import('./pipeline/policy.js')
const service = createModerationService({
	guard,
	policy: { ...DEFAULT_POLICY, shadowMode: SHADOW_MODE },
	...(allowlist ? { allowlist } : {}),
	...(rewrites.length ? { rewrites } : {}),
	...(approvedDomains.length ? { approvedDomains } : {}),
	admission: createAdmissionController(
		{ burst: INGRESS_BURST, refillPerSec: INGRESS_RATE },
		Date.now(),
	),
	onVerdict: (entry) => {
		console.log(JSON.stringify(entry))
	},
})

const server = createModerationServer({
	service,
	// Comma-separated to support zero-downtime rotation: run old+new together
	// while the relay swaps, then drop the old token.
	bearerTokens,
	modelId: GUARD_MODEL ?? 'rank-guard (unconfigured)',
	posture,
	gitSha: process.env.GIT_SHA,
	lists: {
		allowlist: allowlistStatus,
		rewrites: rewritesStatus,
		approvedDomains: approvedDomainsStatus,
	},
})

server.listen(PORT, () => {
	console.error(
		`[moderation] listening on :${PORT} (POST /moderate, GET /health)`,
	)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		console.error(`[moderation] ${signal}, shutting down`)
		server.close(() => process.exit(0))
	})
}
