// Generate the data-derived allowlist candidate file (tier-0 fast-pass).
// Input: unique.jsonl {message, count} sorted by frequency (the 685-day real
// chat export). A message qualifies only if ALL of:
//   - count >= MIN_COUNT (common enough to matter)
//   - normalizeForAllowlist accepts it (allowlist matching is on normalized text)
//   - the deterministic analyzer finds nothing (no obscenity/denylist/safety)
//   - the REAL guard judges it Safe
// Output: allowlist.txt (one normalized message per line, most frequent first,
// with a header comment) for human review before it ships.
//
// Usage: node gen-allowlist.mjs <unique.jsonl> <out.txt> [minCount] [maxEntries]
import { createReadStream, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createLlamaGuardEngine } from './dist/guard/engine.js'
import {
	createDeterministicAnalyzer,
	normalizeForAllowlist,
} from './dist/pipeline/index.js'

const [inFile, outFile, minCountArg, maxArg] = process.argv.slice(2)
const MIN_COUNT = Number(minCountArg ?? 50)
const MAX_ENTRIES = Number(maxArg ?? 3000)
const MODEL = resolve(
	'D:/Things10/server/admin-local/moderation-proto/.model-cache/qwen3guard-gen-0.6b.Q8_0.gguf',
)

// 1. Frequency + deterministic filters (cheap, first).
const candidates = []
const rl = createInterface({ input: createReadStream(inFile) })
const analyzer = createDeterministicAnalyzer()
const seen = new Set()
for await (const line of rl) {
	const { message, count } = JSON.parse(line)
	if (count < MIN_COUNT) continue
	const normalized = normalizeForAllowlist(message)
	if (normalized === null || seen.has(normalized)) continue
	const evidence = analyzer.analyze(message)
	if (evidence.obscenityMatches.length > 0 || evidence.safetySignals.length > 0)
		continue
	seen.add(normalized)
	candidates.push({ normalized, count })
	if (candidates.length >= MAX_ENTRIES * 2) break // headroom before guard filter
}
console.log(
	`deterministic-clean candidates (count>=${MIN_COUNT}): ${candidates.length}`,
)

// 2. Guard filter: only Safe survives.
const engine = await createLlamaGuardEngine({ modelPath: MODEL, threads: 8 })
if (!engine.ready()) throw new Error('guard failed to load')
const kept = []
const droppedByGuard = []
let done = 0
for (const c of candidates) {
	const j = await engine.judge([{ who: 'sender', text: c.normalized }])
	if (j.safety === 'Safe') kept.push(c)
	else droppedByGuard.push({ ...c, safety: j.safety, categories: j.categories })
	if (++done % 500 === 0)
		console.log(`judged ${done}/${candidates.length} (kept ${kept.length})`)
	if (kept.length >= MAX_ENTRIES) break
}

const totalWeight = kept.reduce((a, c) => a + c.count, 0)
const header = [
	`# Data-derived allowlist (tier-0 fast-pass) — generated ${''}from the 685-day chat export.`,
	`# ${kept.length} entries, covering ${totalWeight} historical messages.`,
	'# One NORMALIZED message per line (see normalizeForAllowlist). Lines starting',
	'# with # are ignored. Every entry was deterministic-clean AND judged Safe by',
	'# Qwen3Guard — review before shipping; delete any line you dislike.',
	'',
].join('\n')
writeFileSync(outFile, `${header + kept.map((c) => c.normalized).join('\n')}\n`)
console.log(
	`\nwrote ${kept.length} entries -> ${outFile} (historical coverage: ${totalWeight} msgs)`,
)
console.log('\nguard-rejected candidates (top 20 — worth eyeballing):')
for (const d of droppedByGuard.slice(0, 20))
	console.log(
		`  x${d.count} [${d.safety}:${d.categories.join(',')}] ${d.normalized.slice(0, 60)}`,
	)
