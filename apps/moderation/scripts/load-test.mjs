#!/usr/bin/env node
// Rate-targeting load-test harness for the moderation service (/moderate).
//
// OPEN-LOOP constant-rate scheduler: request START times are fixed by the
// target rate, independent of completions. A closed loop (wait for a response
// before firing the next) slows its offered load exactly when the service
// degrades and therefore under-reports latency at saturation; this harness
// never does that. Zero npm dependencies — plain node:http with an explicit
// keep-alive agent so connection reuse is controlled and measurable.
//
// Smoke test (no models needed):
//   MOCK=1 RATES='50,200' DURATION_S=8 WARMUP_S=2 node scripts/load-test.mjs
//
// Full knob list + how to read the output: docs/10-load-testing.md.

import { writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'

// --- Config (all via env, all with defaults) ---

function envNum(name, fallback) {
	const raw = process.env[name]
	if (raw === undefined || raw === '') return fallback
	const value = Number(raw)
	if (!Number.isFinite(value)) {
		throw new Error(`${name} must be a number, got '${raw}'`)
	}
	return value
}

function parseRates(raw) {
	const rates = raw
		.split(',')
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isFinite(n) && n > 0)
	if (rates.length === 0)
		throw new Error(`RATES has no usable entries: '${raw}'`)
	return rates
}

function parseLengthMix(raw) {
	const parts = raw.split(',').map((s) => Number(s.trim()))
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
		throw new Error(
			`LENGTH_MIX must be 'short,medium,long' percentages, got '${raw}'`,
		)
	}
	return { short: parts[0], medium: parts[1], long: parts[2] }
}

const PROFILES = {
	// Weighted category mix. blocklist + safety(red) skip ML entirely;
	// clean/trash/long_clean run the full scoring path (variants x 2 models).
	realistic: { clean: 60, trash: 15, blocklist: 10, safety: 5, long_clean: 10 },
	worst: { clean: 70, trash: 30, blocklist: 0, safety: 0, long_clean: 0 },
	deterministic: {
		clean: 0,
		trash: 0,
		blocklist: 100,
		safety: 0,
		long_clean: 0,
	},
}

const rates = parseRates(process.env.RATES ?? '25,50,100')
const cfg = {
	url: process.env.SVC_URL ?? 'http://127.0.0.1:48901',
	token: process.env.SVC_TOKEN ?? '',
	rates,
	durationS: envNum('DURATION_S', 45),
	warmupS: envNum('WARMUP_S', 10),
	players: envNum('PLAYERS', 2000),
	profile: process.env.PROFILE ?? 'realistic',
	lengthMix: parseLengthMix(process.env.LENGTH_MIX ?? '50,35,15'),
	sloP95Ms: envNum('SLO_P95_MS', 500),
	sloP99Ms: envNum('SLO_P99_MS', 1000),
	sloErrPct: envNum('SLO_ERR_PCT', 1),
	targetRate: envNum('TARGET_RATE', Math.max(...rates)),
	seed: envNum('SEED', 42),
	out: process.env.OUT ?? '',
	mock: process.env.MOCK === '1',
	maxInflight: envNum('MAX_INFLIGHT', 2000),
	reqTimeoutMs: envNum('REQ_TIMEOUT_MS', 10_000),
}

if (!(cfg.profile in PROFILES)) {
	throw new Error(
		`PROFILE must be one of ${Object.keys(PROFILES).join('|')}, got '${cfg.profile}'`,
	)
}

// --- Seeded PRNG (mulberry32) — reproducible corpus for a given SEED ---

function mulberry32(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function pickWeighted(rng, entries) {
	let total = 0
	for (const [, weight] of entries) total += weight
	let roll = rng() * total
	for (const [key, weight] of entries) {
		roll -= weight
		if (roll < 0) return key
	}
	return entries[entries.length - 1][0]
}

// --- Corpus generator ---
//
// Length buckets respect the service's 2000-char message cap. Category
// determines which pipeline tier decides: blocklist (obscenity/denylist) and
// safety (red contact-exchange signals) short-circuit before ML; clean and
// trash run the full scoring-variant x model matrix. NOTE: no 'preset'
// category — the standalone service ships an EMPTY allowlist (presets live in
// the relay's DB), so that band is unreachable here.

const LENGTH_BUCKETS = {
	short: { min: 5, max: 40 },
	medium: { min: 150, max: 300 },
	long: { min: 900, max: 1900 },
}

const CLEAN_BANK = [
	'nice hand gg',
	'that flush build came out of nowhere',
	'blueprint plus mime is just unfair',
	'i kept the steel joker the whole run',
	'one more game i want a rematch',
	'the boss blind ate my whole economy',
	'photograph plus hanging chad carried me',
	'should have taken the tarot pack',
	'my mult scaling fell off at ante six',
	'lucky cat with oops all sixes is wild',
	'good game that was really close',
	'what deck are you running next round',
	'i love the checkered deck opener',
	'sold my baron for tempo big mistake',
	'shop gave me nothing for three rerolls',
	'planet cards win games trust the flush',
	'went all in on pairs and it paid off',
	'that last hand was beautiful honestly',
	'interest breakpoints matter more than jokers',
	'never skip the small blind for a tag',
]

const TRASH_BANK = [
	'you suck lol',
	'get rekt',
	'ez clap you are so bad',
	'that was the worst play i have ever seen',
	'uninstall the game already lol',
	'skill issue honestly',
	'you got carried by the deck loser',
	'absolute garbage gameplay',
	'stop playing you are terrible at this',
	'my grandma plays better than you',
]

// Deterministic tier: obscenity matcher / denylist ('kys') — no ML runs.
const BLOCKLIST_TRIGGERS = [
	'kys',
	'kill yourself',
	'fuck this game',
	'what the fuck was that',
	'you piece of shit',
	'this is bullshit',
]

// Deterministic safety tier: red contact-exchange signals — no ML runs.
const SAFETY_TRIGGERS = [
	'add me on discord coolkid#1234',
	'join us at discord.gg/balatro',
	'my number is 555 123 4567',
	'email me at coolkid@gmail.com',
	'check discord.gg/jokers for the league',
]

function fillFromBank(rng, bank, targetLen, maxLen) {
	let msg = bank[Math.floor(rng() * bank.length)]
	while (msg.length < targetLen) {
		const next = bank[Math.floor(rng() * bank.length)]
		if (msg.length + 1 + next.length > maxLen) break
		msg = `${msg} ${next}`
	}
	return msg
}

function generateMessage(rng, category, bucket) {
	const { min, max } = LENGTH_BUCKETS[bucket]
	const target = min + Math.floor(rng() * (max - min + 1))
	if (category === 'blocklist' || category === 'safety') {
		const triggers =
			category === 'blocklist' ? BLOCKLIST_TRIGGERS : SAFETY_TRIGGERS
		const trigger = triggers[Math.floor(rng() * triggers.length)]
		if (trigger.length + 6 >= target) return trigger
		const filler = fillFromBank(
			rng,
			CLEAN_BANK,
			target - trigger.length - 1,
			max - trigger.length - 1,
		)
		return `${filler} ${trigger}`
	}
	const bank = category === 'trash' ? TRASH_BANK : CLEAN_BANK
	return fillFromBank(rng, bank, target, max)
}

const CORPUS_SIZE = 2048

function buildCorpus() {
	const rng = mulberry32(cfg.seed)
	const categoryEntries = Object.entries(PROFILES[cfg.profile]).filter(
		([, w]) => w > 0,
	)
	const lengthEntries = [
		['short', cfg.lengthMix.short],
		['medium', cfg.lengthMix.medium],
		['long', cfg.lengthMix.long],
	]
	const corpus = []
	for (let i = 0; i < CORPUS_SIZE; i++) {
		const category = pickWeighted(rng, categoryEntries)
		const bucket =
			category === 'long_clean' ? 'long' : pickWeighted(rng, lengthEntries)
		corpus.push({
			message: generateMessage(rng, category, bucket),
			category,
			bucket,
		})
	}
	return corpus
}

// --- HTTP transport (node:http[s] + explicit keep-alive agent) ---

function createTransport(baseUrl) {
	const target = new URL(baseUrl)
	const isHttps = target.protocol === 'https:'
	const client = isHttps ? https : http
	const agent = new client.Agent({
		keepAlive: true,
		maxSockets: cfg.maxInflight,
		maxFreeSockets: 256,
	})
	const port = target.port !== '' ? Number(target.port) : isHttps ? 443 : 80
	const baseHeaders = { 'content-type': 'application/json' }
	if (cfg.token !== '') baseHeaders.authorization = `Bearer ${cfg.token}`

	return {
		postModerate(payload, onDone) {
			let settled = false
			const settle = (status, body) => {
				if (settled) return
				settled = true
				onDone(status, body)
			}
			const req = client.request(
				{
					hostname: target.hostname,
					port,
					path: '/moderate',
					method: 'POST',
					agent,
					headers: {
						...baseHeaders,
						'content-length': Buffer.byteLength(payload),
					},
				},
				(res) => {
					let body = ''
					res.setEncoding('utf8')
					res.on('data', (chunk) => {
						body += chunk
					})
					res.on('end', () => settle(res.statusCode ?? 0, body))
				},
			)
			req.setTimeout(cfg.reqTimeoutMs, () => req.destroy(new Error('timeout')))
			req.on('error', () => settle(0, null))
			req.end(payload)
		},
		getHealth() {
			return new Promise((resolve) => {
				const req = client.request(
					{
						hostname: target.hostname,
						port,
						path: '/health',
						method: 'GET',
						agent,
					},
					(res) => {
						res.resume()
						res.on('end', () => resolve(res.statusCode ?? 0))
					},
				)
				req.setTimeout(3000, () => req.destroy(new Error('timeout')))
				req.on('error', () => resolve(0))
				req.end()
			})
		},
		destroy() {
			agent.destroy()
		},
	}
}

// --- MOCK=1 self-test server: canned verdict after a 5-30ms delay ---

function startMockServer() {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			if (req.method === 'GET' && req.url === '/health') {
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end('{"status":"ok","model":"mock","model_loaded":true}')
				return
			}
			req.resume()
			req.on('end', () => {
				const delayMs = 5 + Math.random() * 25
				setTimeout(() => {
					res.writeHead(200, { 'content-type': 'application/json' })
					res.end(
						JSON.stringify({
							verdict: 'allow',
							band: 'clean',
							latency_ms: Math.round(delayMs),
						}),
					)
				}, delayMs)
			})
		})
		server.keepAliveTimeout = 60_000
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address()
			resolve({
				url: `http://127.0.0.1:${port}`,
				close: () => server.close(),
			})
		})
	})
}

// --- One stage: fire at `rate` rps for WARMUP_S + DURATION_S ---
//
// Requests with index < warmupCount are fired but excluded from every stat.
// The scheduler is drift-corrected: each 50ms tick computes how many starts
// are due from wall-clock elapsed time and fires the deficit, so a slow tick
// never lowers the offered rate. When in-flight is at MAX_INFLIGHT the
// request is counted as 'dropped' instead of fired (the open-loop equivalent
// of a queue overflowing — it means the service is not keeping up).

function recordOutcome(stats, entry, status, body, clientMs) {
	if (status === 0) {
		stats.httpErrors++
		return
	}
	stats.statuses[status] = (stats.statuses[status] ?? 0) + 1
	let parsed = null
	if (body !== null && body !== '') {
		try {
			parsed = JSON.parse(body)
		} catch {
			parsed = null
		}
	}
	if (status === 429) {
		// The service 429s only when the GLOBAL admission bucket sheds.
		if (parsed !== null && parsed.band === 'shed') stats.shed++
		else stats.httpErrors++
		return
	}
	if (status !== 200) {
		stats.httpErrors++
		return
	}
	stats.completed++
	const band =
		parsed !== null && typeof parsed.band === 'string' ? parsed.band : 'unknown'
	stats.bands[band] = (stats.bands[band] ?? 0) + 1
	if (parsed !== null && parsed.verdict === 'allow') stats.allow++
	else stats.reject++
	stats.latencies.push(clientMs)
	stats.bucketLatencies[entry.bucket].push(clientMs)
	if (parsed !== null && typeof parsed.latency_ms === 'number') {
		stats.serverLatencies.push(parsed.latency_ms)
	}
}

function runStage(rate, corpus, transport) {
	const warmupCount = Math.round(rate * cfg.warmupS)
	const totalPlanned = warmupCount + Math.round(rate * cfg.durationS)
	const stats = {
		rate,
		offered: 0,
		completed: 0,
		dropped: 0,
		shed: 0,
		httpErrors: 0,
		allow: 0,
		reject: 0,
		bands: {},
		statuses: {},
		latencies: [],
		serverLatencies: [],
		bucketLatencies: { short: [], medium: [], long: [] },
		inflightHwm: 0,
	}
	let scheduled = 0
	let inflight = 0

	const fireOne = (index) => {
		const measured = index >= warmupCount
		if (measured) stats.offered++
		if (inflight >= cfg.maxInflight) {
			if (measured) stats.dropped++
			return
		}
		inflight++
		if (inflight > stats.inflightHwm) stats.inflightHwm = inflight
		const entry = corpus[index % corpus.length]
		const payload = JSON.stringify({
			playerId: `lt-${index % cfg.players}`,
			displayName: 'LoadTest',
			lobbyCode: 'LOAD',
			message: entry.message,
		})
		const startedAt = performance.now()
		transport.postModerate(payload, (status, body) => {
			inflight--
			if (!measured) return
			recordOutcome(stats, entry, status, body, performance.now() - startedAt)
		})
	}

	return new Promise((resolve) => {
		const stageStart = performance.now()
		let nextProgressS = 10
		const timer = setInterval(() => {
			const elapsedS = (performance.now() - stageStart) / 1000
			const due = Math.min(totalPlanned, Math.floor(elapsedS * rate))
			while (scheduled < due) {
				fireOne(scheduled)
				scheduled++
			}
			if (elapsedS >= nextProgressS) {
				nextProgressS += 10
				process.stderr.write(
					`  [${rate} rps] t=${elapsedS.toFixed(0)}s scheduled=${scheduled}/${totalPlanned} inflight=${inflight} shed=${stats.shed} err=${stats.httpErrors}\n`,
				)
			}
			if (scheduled >= totalPlanned) {
				clearInterval(timer)
				const drain = setInterval(() => {
					if (inflight === 0) {
						clearInterval(drain)
						resolve(stats)
					}
				}, 25)
			}
		}, 50)
	})
}

// --- Stats → summary ---

function percentile(sorted, p) {
	if (sorted.length === 0) return Number.NaN
	const idx = Math.max(
		0,
		Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1),
	)
	return sorted[idx]
}

function summarize(stats) {
	const lat = [...stats.latencies].sort((a, b) => a - b)
	const srv = [...stats.serverLatencies].sort((a, b) => a - b)
	const errors = stats.httpErrors + stats.shed + stats.dropped
	const errPct = stats.offered === 0 ? 0 : (errors / stats.offered) * 100
	const p95 = percentile(lat, 95)
	const p99 = percentile(lat, 99)
	const pass =
		stats.completed > 0 &&
		p95 <= cfg.sloP95Ms &&
		p99 <= cfg.sloP99Ms &&
		errPct <= cfg.sloErrPct
	const bucketP95 = {}
	for (const bucket of Object.keys(stats.bucketLatencies)) {
		const sorted = [...stats.bucketLatencies[bucket]].sort((a, b) => a - b)
		bucketP95[bucket] = { p95: percentile(sorted, 95), n: sorted.length }
	}
	return {
		rate: stats.rate,
		offeredPerSec: stats.offered / cfg.durationS,
		achievedPerSec: stats.completed / cfg.durationS,
		completed: stats.completed,
		p50: percentile(lat, 50),
		p90: percentile(lat, 90),
		p95,
		p99,
		max: lat.length > 0 ? lat[lat.length - 1] : Number.NaN,
		srvP50: percentile(srv, 50),
		srvP95: percentile(srv, 95),
		inflightHwm: stats.inflightHwm,
		errPct,
		shed: stats.shed,
		dropped: stats.dropped,
		httpErrors: stats.httpErrors,
		allow: stats.allow,
		reject: stats.reject,
		bands: stats.bands,
		statuses: stats.statuses,
		bucketP95,
		sloPass: pass,
	}
}

// --- Rendering ---

function fmtMs(v) {
	return Number.isNaN(v) ? '-' : v.toFixed(0)
}

function renderTable(headers, rows) {
	const widths = headers.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => String(r[i]).length)),
	)
	const line = (cells) =>
		cells.map((c, i) => String(c).padStart(widths[i])).join('  ')
	const out = [line(headers), line(widths.map((w) => '-'.repeat(w)))]
	for (const row of rows) out.push(line(row))
	return out.join('\n')
}

const BAND_COLUMNS = [
	'clean',
	'review',
	'blocklist',
	'safety_block',
	'ml_block',
	'rate_limited',
]

function renderResults(summaries) {
	const lines = []
	lines.push('')
	lines.push(
		`profile=${cfg.profile} players=${cfg.players} lengthMix=${cfg.lengthMix.short}/${cfg.lengthMix.medium}/${cfg.lengthMix.long} seed=${cfg.seed} warmup=${cfg.warmupS}s duration=${cfg.durationS}s`,
	)
	lines.push(
		`SLO: p95<=${cfg.sloP95Ms}ms p99<=${cfg.sloP99Ms}ms err<=${cfg.sloErrPct}% (errors = http errors + shed + dropped; rate_limited counts separately)`,
	)
	lines.push('')
	lines.push('Latency (client round-trip, ms) — post-warmup window only:')
	lines.push(
		renderTable(
			[
				'RATE',
				'OFFER/s',
				'ACH/s',
				'P50',
				'P90',
				'P95',
				'P99',
				'MAX',
				'SRV_P50',
				'SRV_P95',
				'HWM',
				'ERR%',
				'SLO',
			],
			summaries.map((s) => [
				s.rate,
				s.offeredPerSec.toFixed(1),
				s.achievedPerSec.toFixed(1),
				fmtMs(s.p50),
				fmtMs(s.p90),
				fmtMs(s.p95),
				fmtMs(s.p99),
				fmtMs(s.max),
				fmtMs(s.srvP50),
				fmtMs(s.srvP95),
				s.inflightHwm,
				s.errPct.toFixed(2),
				s.sloPass ? 'PASS' : 'FAIL',
			]),
		),
	)
	lines.push('')
	lines.push('Outcomes (counts, post-warmup):')
	lines.push(
		renderTable(
			[
				'RATE',
				...BAND_COLUMNS,
				'shed_429',
				'dropped',
				'http_err',
				'allow',
				'reject',
			],
			summaries.map((s) => [
				s.rate,
				...BAND_COLUMNS.map((b) => s.bands[b] ?? 0),
				s.shed,
				s.dropped,
				s.httpErrors,
				s.allow,
				s.reject,
			]),
		),
	)
	lines.push('')
	lines.push('Client p95 by message length (ms, n = samples):')
	lines.push(
		renderTable(
			['RATE', 'SHORT_P95', 'n', 'MEDIUM_P95', 'n', 'LONG_P95', 'n'],
			summaries.map((s) => [
				s.rate,
				fmtMs(s.bucketP95.short.p95),
				s.bucketP95.short.n,
				fmtMs(s.bucketP95.medium.p95),
				s.bucketP95.medium.n,
				fmtMs(s.bucketP95.long.p95),
				s.bucketP95.long.n,
			]),
		),
	)
	lines.push('')
	return lines.join('\n')
}

// --- Main ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
	const mock = cfg.mock ? await startMockServer() : null
	const baseUrl = mock !== null ? mock.url : cfg.url
	const transport = createTransport(baseUrl)

	const health = await transport.getHealth()
	if (health !== 200) {
		process.stderr.write(
			health === 0
				? `FATAL: cannot reach ${baseUrl}/health — is the service running?\n`
				: `FATAL: ${baseUrl}/health returned ${health} (model still loading?). Refusing to test a non-ready service.\n`,
		)
		transport.destroy()
		if (mock !== null) mock.close()
		process.exitCode = 1
		return
	}

	const corpus = buildCorpus()
	process.stderr.write(
		`target=${baseUrl} stages=[${cfg.rates.join(', ')}] rps, ${cfg.warmupS}s warmup + ${cfg.durationS}s measured each, profile=${cfg.profile}, ${cfg.players} players\n`,
	)

	const summaries = []
	for (const rate of cfg.rates) {
		process.stderr.write(`\n=== stage ${rate} rps ===\n`)
		const stats = await runStage(rate, corpus, transport)
		summaries.push(summarize(stats))
		await sleep(1000)
	}

	process.stdout.write(renderResults(summaries))

	const worstShed = summaries.reduce(
		(acc, s) =>
			Math.max(
				acc,
				s.offeredPerSec > 0 ? s.shed / (s.offeredPerSec * cfg.durationS) : 0,
			),
		0,
	)
	if (worstShed > 0.05) {
		process.stdout.write(
			[
				'',
				`NOTE: up to ${(worstShed * 100).toFixed(0)}% of requests were SHED by global ingress`,
				'admission (HTTP 429, band=shed). The service defaults to burst 50 /',
				'25 req/s as deliberate self-protection. To measure the hardware ceiling',
				'instead of the policy ceiling, restart the service with e.g.:',
				'  MODERATION_INGRESS_BURST=600 MODERATION_INGRESS_RATE=300',
				'',
			].join('\n'),
		)
	}

	const targetSummary =
		summaries.find((s) => s.rate === cfg.targetRate) ??
		summaries[summaries.length - 1]
	process.stdout.write(
		`\nTARGET_RATE=${targetSummary.rate} rps → ${targetSummary.sloPass ? 'SLO PASS' : 'SLO FAIL'}\n`,
	)
	if (!targetSummary.sloPass) process.exitCode = 1

	if (cfg.out !== '') {
		writeFileSync(
			cfg.out,
			`${JSON.stringify({ config: { ...cfg, token: cfg.token !== '' ? '<set>' : '' }, stages: summaries }, null, '\t')}\n`,
		)
		process.stderr.write(`full results written to ${cfg.out}\n`)
	}

	transport.destroy()
	if (mock !== null) mock.close()
}

await main()
