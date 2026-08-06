import { describe, expect, it } from 'vitest'
import type { GuardEngine } from '../guard/engine.js'
import { DEFAULT_POLICY } from '../pipeline/policy.js'
import {
	canMeetDeadline,
	createJudgeLane,
	createModerationService,
} from './service.js'

/** A guard that answers Safe for everything, instantly. */
function safeGuard(): GuardEngine {
	return {
		ready: () => true,
		judge: async () => ({
			safety: 'Safe',
			categories: [],
			latencyMs: 0,
			raw: '',
		}),
	}
}

/** Unsafe on 'hurt you', Safe otherwise — the guard-tier stand-in. */
function threatGuard(): GuardEngine {
	return {
		ready: () => true,
		judge: async (turns) => {
			const text = turns[turns.length - 1]?.text ?? ''
			const unsafe = text.includes('hurt you')
			return {
				safety: unsafe ? 'Unsafe' : 'Safe',
				categories: unsafe ? ['Violent'] : [],
				latencyMs: 0,
				raw: '',
			}
		},
	}
}

/** A guard that records every text it was asked to judge. */
function recordingGuard(): { guard: GuardEngine; judged: string[] } {
	const judged: string[] = []
	return {
		judged,
		guard: {
			ready: () => true,
			judge: async (turns) => {
				judged.push(turns[turns.length - 1]?.text ?? '')
				return { safety: 'Safe', categories: [], latencyMs: 0, raw: '' }
			},
		},
	}
}

const req = (message: string, playerId = 'p1') => ({
	playerId,
	lobbyCode: 'ABCD',
	message,
})

describe('createJudgeLane', () => {
	it('returns the judgement when it lands inside the deadline', async () => {
		const lane = createJudgeLane(threatGuard())
		const g = await lane.judge('i will hurt you', 1000)
		expect(g).toEqual({ safety: 'Unsafe', categories: ['Violent'] })
	})

	it('fails closed with skipped:deadline when the judgement is too slow', async () => {
		const slow: GuardEngine = {
			ready: () => true,
			judge: () => new Promise(() => {}), // never resolves
		}
		const lane = createJudgeLane(slow)
		const g = await lane.judge('hello', 10)
		expect(g).toEqual({ skipped: 'deadline' })
		expect(lane.depth()).toBe(1) // abandoned judgement still occupies the lane
	})

	it('fails closed when the engine is not loaded', async () => {
		const dead: GuardEngine = {
			ready: () => false,
			judge: async () => {
				throw new Error('not loaded')
			},
		}
		expect(await createJudgeLane(dead).judge('hello', 1000)).toEqual({
			skipped: 'engine_not_ready',
		})
	})

	it('fails closed when the engine throws', async () => {
		const broken: GuardEngine = {
			ready: () => true,
			judge: async () => {
				throw new Error('boom')
			},
		}
		expect(await createJudgeLane(broken).judge('hello', 1000)).toEqual({
			skipped: 'engine_error',
		})
	})

	it('waits indefinitely when deadline is 0', async () => {
		const lane = createJudgeLane(safeGuard())
		expect(await lane.judge('hello', 0)).toEqual({
			safety: 'Safe',
			categories: [],
		})
	})

	it('avgJudgeMs is null before any judgement lands, then reflects completed ones (for /health)', async () => {
		const lane = createJudgeLane(safeGuard())
		expect(lane.avgJudgeMs()).toBeNull()
		await lane.judge('hello', 1000)
		expect(lane.avgJudgeMs()).not.toBeNull()
	})

	it('short-circuits skipped:backlog once the lane cannot make the deadline', async () => {
		// Engine takes ~40ms per judgement; deadline 50ms fits ONE judgement
		// but not a queue of them. After the first completes (EMA known), a
		// judge call arriving while another occupies the lane must be rejected
		// immediately, not after the deadline.
		let release: (() => void) | undefined
		const engine: GuardEngine = {
			ready: () => true,
			judge: () =>
				new Promise((resolve) => {
					release = () =>
						resolve({ safety: 'Safe', categories: [], latencyMs: 0, raw: '' })
					setTimeout(release, 40)
				}),
		}
		const lane = createJudgeLane(engine)
		await lane.judge('warm up the EMA', 1000) // avg ≈ 40ms

		const first = lane.judge('occupies the lane', 1000)
		const started = performance.now()
		const second = await lane.judge('cannot make a 50ms deadline', 50)
		const took = performance.now() - started
		expect(second).toEqual({ skipped: 'backlog' })
		expect(took).toBeLessThan(25) // immediate, did not wait out the deadline
		await first
	})

	it('never backlog-rejects an EMPTY lane — a slow cold start must not lock it out (regression)', async () => {
		// One judgement completing slower than the deadline teaches the EMA
		// "too slow". Observed live: the lane then rejected every message on an
		// idle box forever, because nothing ever ran to correct the EMA. An
		// empty lane must always attempt (the deadline race bounds the wait),
		// so the EMA can recover as the engine warms up.
		let judgeMs = 60 // cold: slower than the 30ms deadline
		const engine: GuardEngine = {
			ready: () => true,
			judge: () =>
				new Promise((resolve) =>
					setTimeout(
						() =>
							resolve({
								safety: 'Safe',
								categories: [],
								latencyMs: 0,
								raw: '',
							}),
						judgeMs,
					),
				),
		}
		const lane = createJudgeLane(engine)
		expect(await lane.judge('cold start', 30)).toEqual({ skipped: 'deadline' })
		await new Promise((r) => setTimeout(r, 60)) // let the abandoned judgement finish (EMA ≈ 60ms)

		// lane idle, EMA pessimistic — must still ATTEMPT, not backlog-reject
		judgeMs = 5 // engine has warmed up
		expect(await lane.judge('after warmup', 30)).toEqual({
			safety: 'Safe',
			categories: [],
		})
	})
})

describe('canMeetDeadline', () => {
	it('is optimistic before any judgement has completed', () => {
		expect(canMeetDeadline(10, null, 100)).toBe(true)
	})
	it('always true when the deadline is disabled', () => {
		expect(canMeetDeadline(10, 5000, 0)).toBe(true)
	})
	it('accounts for the arriving judgement itself', () => {
		expect(canMeetDeadline(0, 60, 50)).toBe(false) // own judgement alone misses
		expect(canMeetDeadline(0, 40, 50)).toBe(true)
		expect(canMeetDeadline(1, 40, 50)).toBe(false) // one ahead in the lane
	})
})

describe('createModerationService', () => {
	it('allows clean chat', async () => {
		const s = createModerationService({ guard: safeGuard() })
		const r = await s.moderate(req('that flush build was crazy'))
		expect(r.verdict).toBe('allow')
		expect(r.band).toBe('clean')
	})

	it('fast-passes allowlisted presets without judging', async () => {
		const { guard, judged } = recordingGuard()
		const s = createModerationService({
			guard,
			allowlist: new Set(['nice hand']),
		})
		const r = await s.moderate(req('Nice Hand!'))
		expect(r.band).toBe('preset')
		expect(judged).toHaveLength(0)
	})

	it('strips unapproved links before judging AND publishing', async () => {
		const { guard, judged } = recordingGuard()
		const s = createModerationService({ guard })
		const r = await s.moderate(req('check this https://evil.example/x'))
		expect(r.verdict).toBe('allow')
		// The stripped form is both what the guard judged and what gets published.
		expect(judged[0]).toBe('check this [link removed]')
		expect(r.publishText).toBe('check this [link removed]')
	})

	it('keeps approved-domain links intact (no rewrite of the message)', async () => {
		const { guard, judged } = recordingGuard()
		const s = createModerationService({
			guard,
			approvedDomains: ['youtube.com'],
		})
		const r = await s.moderate(req('https://www.youtube.com/watch?v=abc'))
		expect(r.verdict).toBe('allow')
		expect(judged[0]).toBe('https://www.youtube.com/watch?v=abc')
		expect(r.publishText).toBeUndefined()
	})

	it('rejects denylist phrases through leetspeak without judging', async () => {
		const { guard, judged } = recordingGuard()
		const s = createModerationService({ guard })
		const r = await s.moderate(req('k1ll y0urs3lf'))
		expect(r.verdict).toBe('reject')
		expect(r.band).toBe('blocklist')
		expect(judged).toHaveLength(0)
	})

	it('routes contact exchange (phone number) to review, not block', async () => {
		const s = createModerationService({ guard: safeGuard() })
		const r = await s.moderate(req('call me 555 123 4567'))
		expect(r.verdict).toBe('allow')
		expect(r.band).toBe('review')
	})

	it('shadow mode publishes a guard would-block as review', async () => {
		const s = createModerationService({ guard: threatGuard() })
		const r = await s.moderate(req('i will hurt you'))
		expect(r.verdict).toBe('allow')
		expect(r.band).toBe('review')
	})

	it('enforce mode rejects the same message as guard_block', async () => {
		const s = createModerationService({
			guard: threatGuard(),
			policy: { ...DEFAULT_POLICY, shadowMode: false },
		})
		const r = await s.moderate(req('i will hurt you'))
		expect(r.verdict).toBe('reject')
		expect(r.band).toBe('guard_block')
	})

	it('a deadline-slow guard fails CLOSED: rejects with guard_unavailable + retry hint', async () => {
		const slow: GuardEngine = {
			ready: () => true,
			judge: () => new Promise(() => {}),
		}
		const s = createModerationService({
			guard: slow,
			policy: { ...DEFAULT_POLICY, shadowMode: false, guardDeadlineMs: 10 },
		})
		const r = await s.moderate(req('some borderline thing'))
		expect(r.verdict).toBe('reject')
		expect(r.band).toBe('guard_unavailable')
		expect(r.reason).toBe('guard_unavailable')
	})

	// The service used to hold a per-player token bucket — the only per-player
	// state it had. Rate limiting now lives solely in the relay's chat route
	// (same budget, applied earlier), so a burst from one player must reach the
	// guard unthrottled rather than being shed by a second, duplicate limiter.
	it('keeps no per-player state: a burst from one player is judged, not throttled', async () => {
		const clock = () => 1000 // frozen: any surviving bucket could not refill
		const { guard, judged } = recordingGuard()
		const s = createModerationService({ guard, clock })

		for (let i = 0; i < 8; i++) {
			const r = await s.moderate(req(`msg ${i}`))
			expect(r.band).toBe('clean')
		}

		expect(judged).toHaveLength(8)
	})

	it('judging is independent of player history (stateless)', async () => {
		const clock = () => 1000
		const g1 = recordingGuard()
		const g2 = recordingGuard()
		const message = 'hello there'
		const r1 = await createModerationService({
			guard: g1.guard,
			clock,
		}).moderate(req(message))
		const r2 = await createModerationService({
			guard: g2.guard,
			clock,
		}).moderate(req(message))
		expect(r1.verdict).toBe(r2.verdict)
		expect(r1.band).toBe(r2.band)

		// Ten earlier messages from the same player, clock advanced past a full
		// refill each time, must not change the eleventh's band.
		let t = 1000
		const s = createModerationService({ guard: safeGuard(), clock: () => t })
		for (let i = 0; i < 10; i++) {
			t += 2000 // 0.5 tok/s -> full refill between messages
			await s.moderate(req(`prior ${i}`))
		}
		t += 2000
		const eleventh = await s.moderate(req(message))
		expect(eleventh.band).toBe('clean')
	})

	it('sheds load when global admission is exhausted', async () => {
		const s = createModerationService({
			guard: safeGuard(),
			admission: { admit: () => false },
		})
		const r = await s.moderate(req('hello'))
		expect(r.band).toBe('shed')
		expect(r.reason).toBe('service_overloaded')
	})

	it('rejects whitespace-only messages', async () => {
		const s = createModerationService({ guard: safeGuard() })
		const r = await s.moderate(req('   '))
		expect(r.verdict).toBe('reject')
		expect(r.reason).toBe('empty')
	})

	it('emits a verdict entry for every decision', async () => {
		const entries: Record<string, unknown>[] = []
		const s = createModerationService({
			guard: safeGuard(),
			onVerdict: (e) => entries.push(e),
		})
		await s.moderate(req('hello there'))
		await s.moderate(req('k1ll y0urs3lf'))
		expect(entries).toHaveLength(2)
		expect(entries[1]).toMatchObject({ decision: 'reject', band: 'blocklist' })
		// Telemetry must never carry message content — that's the DB's job, and
		// stdout must not become a second chat archive.
		for (const e of entries) {
			expect(e.message).toBeUndefined()
			expect(e.publishText).toBeUndefined()
		}
	})

	it('records wouldHaveBlocked + guard fields on a shadow would-block — the exact row EVAL.md needs to pull daily', async () => {
		const entries: Record<string, unknown>[] = []
		const s = createModerationService({
			guard: threatGuard(),
			onVerdict: (e) => entries.push(e),
		})
		const r = await s.moderate(req('i will hurt you'))
		expect(r.band).toBe('review')
		expect(entries).toHaveLength(1)
		expect(entries[0]).toMatchObject({
			band: 'review',
			wouldHaveBlocked: true,
			guardSafety: 'Unsafe',
			guardCategories: ['Violent'],
		})
	})

	it('does not set wouldHaveBlocked on a genuine Controversial review — the two must stay distinguishable', async () => {
		const entries: Record<string, unknown>[] = []
		const s = createModerationService({
			guard: safeGuard(),
			onVerdict: (e) => entries.push(e),
		})
		await s.moderate(req('call me 555 123 4567')) // routes to review via PII, not the guard
		expect(entries[0]).toMatchObject({
			band: 'review',
			wouldHaveBlocked: false,
		})
	})

	it('logs match COUNTS, never the matched words, for blocklist/threat/safety tiers', async () => {
		const entries: Record<string, unknown>[] = []
		const s = createModerationService({
			guard: safeGuard(),
			onVerdict: (e) => entries.push(e),
		})
		await s.moderate(req('k1ll y0urs3lf'))
		expect(entries[0]).toMatchObject({ obscenityMatchCount: 1 })
		expect(entries[0]).not.toHaveProperty('obscenityMatches')
		expect(entries[0]).not.toHaveProperty('threatMatches')
		expect(entries[0]).not.toHaveProperty('safetySignals')
	})

	describe('guard input length cap (scoreMaxChars)', () => {
		// ~1840 chars, deliberately benign so it reaches the guard tier (no
		// obscenity/denylist/PII short-circuit).
		const longClean = 'good game everyone that was a really fun match '.repeat(
			40,
		)

		it('caps the judged input to policy.scoreMaxChars on the hot path', async () => {
			const { guard, judged } = recordingGuard()
			const s = createModerationService({ guard }) // DEFAULT_POLICY: 400
			await s.moderate(req(longClean))
			expect(judged.length).toBeGreaterThan(0) // the guard actually ran
			expect(judged.every((t) => t.length <= 400)).toBe(true)
		})

		it('still enforces a denylist phrase sitting past the cap (full-text scan)', async () => {
			// The deterministic tiers must see the WHOLE message even though the
			// guard only sees the first 400 chars — a slur at char ~675 still blocks.
			const filler = 'lorem ipsum dolor sit amet '.repeat(25) // ~675 chars
			const s = createModerationService({ guard: safeGuard() })
			const r = await s.moderate(req(`${filler}kill yourself`))
			expect(r.verdict).toBe('reject')
			expect(r.band).toBe('blocklist')
		})

		it('scoreMaxChars=0 disables the cap (offline/eval parity)', async () => {
			const { guard, judged } = recordingGuard()
			const s = createModerationService({
				guard,
				policy: { ...DEFAULT_POLICY, scoreMaxChars: 0 },
			})
			await s.moderate(req(longClean))
			expect(judged.some((t) => t.length > 400)).toBe(true)
		})
	})

	describe('verdict-only shape', () => {
		it('behaves byte-identically for a clean message', async () => {
			const clock = () => 1000
			const s = createModerationService({ guard: safeGuard(), clock })
			const r = await s.moderate(req('hello there'))
			expect(r).toEqual({ verdict: 'allow', band: 'clean', latency_ms: 0 })
		})
	})

	describe('diagnostics (GET /health)', () => {
		it('reports the guard load error and null latency before any judgement', () => {
			const s = createModerationService({
				guard: {
					ready: () => false,
					loadError: () => 'ENOENT: model file missing',
					judge: async () => {
						throw new Error('not loaded')
					},
				},
			})
			expect(s.diagnostics()).toEqual({
				modelLoadError: 'ENOENT: model file missing',
				guardInflight: 0,
				guardAvgJudgeMs: null,
			})
		})

		it('reports null load error and a completed judgement latency once the guard has judged', async () => {
			const s = createModerationService({ guard: safeGuard() })
			await s.moderate(req('hello there'))
			const d = s.diagnostics()
			expect(d.modelLoadError).toBeNull()
			expect(d.guardInflight).toBe(0)
			expect(d.guardAvgJudgeMs).not.toBeNull()
		})
	})
})
