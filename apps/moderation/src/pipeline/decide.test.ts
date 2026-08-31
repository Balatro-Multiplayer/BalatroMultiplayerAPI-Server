import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decideModeration } from './decide.js'
import { DEFAULT_POLICY } from './policy.js'
import type {
	Band,
	DecisionInput,
	GuardInput,
	GuardSafetyLevel,
	ModerationPolicy,
	TokenBucket,
} from './types.js'

const ENFORCE: ModerationPolicy = { ...DEFAULT_POLICY, shadowMode: false }

function guard(safety: GuardSafetyLevel, score?: number): GuardInput {
	return score === undefined ? { safety } : { safety, score }
}

function input(over: Partial<DecisionInput> = {}): DecisionInput {
	return {
		message: 'hello',
		nowMs: 1000,
		isAllowlisted: false,
		threatMatches: [],
		obscenityMatches: [],
		safetySignals: [],
		guard: guard('Safe'),
		policy: ENFORCE,
		...over,
	}
}

describe('decideModeration — precedence', () => {
	it('threat_block beats allowlist and a Safe guard, and enforces in shadow', () => {
		const threatMatches = [{ word: 'kill you', startIndex: 0, endIndex: 8 }]
		const d = decideModeration(
			input({ threatMatches, isAllowlisted: true, guard: guard('Safe') }),
		)
		expect(d.band).toBe('threat_block')
		expect(d.decision).toBe('reject')
		expect(d.verdict.threatMatches).toEqual(threatMatches)
		// Deterministic tier: shadow mode does NOT downgrade it.
		const shadow = decideModeration(
			input({ threatMatches, policy: { ...ENFORCE, shadowMode: true } }),
		)
		expect(shadow.decision).toBe('reject')
		expect(shadow.band).toBe('threat_block')
	})

	it('preset fast-pass skips blocklist and the guard', () => {
		const d = decideModeration(
			input({
				isAllowlisted: true,
				obscenityMatches: [{ word: 'x', startIndex: 0, endIndex: 1 }],
				guard: guard('Unsafe'),
			}),
		)
		expect(d.band).toBe('preset')
		expect(d.decision).toBe('allow')
	})

	it('blocklist beats the guard', () => {
		const matches = [{ word: 'slur', startIndex: 0, endIndex: 4 }]
		const d = decideModeration(
			input({ obscenityMatches: matches, guard: guard('Safe') }),
		)
		expect(d.band).toBe('blocklist')
		expect(d.decision).toBe('reject')
		expect(d.verdict.obscenityMatches).toEqual(matches)
	})
})

describe('decideModeration — guard bands', () => {
	it('Unsafe blocks in enforce mode (ADR-6: no auto-strike, a human/queue decides)', () => {
		const d = decideModeration(input({ guard: guard('Unsafe') }))
		expect(d.band).toBe('guard_block')
		expect(d.decision).toBe('reject')
	})

	it('Unsafe with no score still blocks', () => {
		const d = decideModeration(input({ guard: guard('Unsafe') }))
		expect(d.band).toBe('guard_block')
		expect(d.decision).toBe('reject')
	})

	it('Controversial publishes with review', () => {
		const d = decideModeration(
			input({ guard: guard('Controversial') }),
		)
		expect(d.band).toBe('review')
		expect(d.decision).toBe('allow')
	})

	it('unknown (unparseable model output) publishes with review — never widens to Safe', () => {
		const d = decideModeration(input({ guard: guard('unknown') }))
		expect(d.band).toBe('review')
		expect(d.decision).toBe('allow')
	})

	it('Safe publishes clean', () => {
		const d = decideModeration(input({ guard: guard('Safe') }))
		expect(d.band).toBe('clean')
		expect(d.decision).toBe('allow')
	})

	it('shadow mode downgrades an Unsafe block to review with wouldHaveBlocked', () => {
		const d = decideModeration(
			input({
				policy: DEFAULT_POLICY,
				guard: guard('Unsafe'),
			}),
		)
		expect(d.decision).toBe('allow')
		expect(d.band).toBe('review')
		expect(d.verdict.wouldHaveBlocked).toBe(true)
	})

	it('records the guard verdict in the verdict json', () => {
		const d = decideModeration(
			input({ guard: guard('Controversial', 0.5) }),
		)
		expect(d.verdict.guardSafety).toBe('Controversial')
		expect(d.verdict.guardScore).toBe(0.5)
	})
})

describe('decideModeration — safety tier (ADR-8)', () => {
	it('red safety signal rejects with safety_block', () => {
		const d = decideModeration(
			input({
				safetySignals: [{ severity: 'red', kind: 'phone' }],
				guard: guard('Safe'),
			}),
		)
		expect(d.decision).toBe('reject')
		expect(d.band).toBe('safety_block')
	})

	it('red safety rejects even in shadow mode (deterministic tiers always enforce)', () => {
		const d = decideModeration(
			input({
				policy: DEFAULT_POLICY,
				safetySignals: [{ severity: 'red', kind: 'email' }],
			}),
		)
		expect(d.decision).toBe('reject')
		expect(d.band).toBe('safety_block')
	})

	it('orange safety publishes but forces review when the guard says Safe', () => {
		const d = decideModeration(
			input({
				safetySignals: [{ severity: 'orange', kind: 'intent_phrase' }],
				guard: guard('Safe'),
			}),
		)
		expect(d.decision).toBe('allow')
		expect(d.band).toBe('review')
	})

	it('orange safety alone does NOT excuse a skipped guard — still fails closed', () => {
		// Orange safety forces review only when a real guard verdict exists
		// (see the test above). With no verdict at all it must not be treated
		// as "already resolved" — that was Defect 1's fail-open path.
		const d = decideModeration(
			input({
				safetySignals: [{ severity: 'orange', kind: 'intent_phrase' }],
				guard: { skipped: 'deadline' },
			}),
		)
		expect(d.decision).toBe('reject')
		expect(d.band).toBe('guard_unavailable')
	})

	it('preset fast-pass beats safety signals (presets are curated)', () => {
		const d = decideModeration(
			input({
				isAllowlisted: true,
				safetySignals: [{ severity: 'red', kind: 'url' }],
			}),
		)
		expect(d.band).toBe('preset')
		expect(d.decision).toBe('allow')
	})

	it('blocklist takes precedence over safety_block', () => {
		const d = decideModeration(
			input({
				obscenityMatches: [{ word: 'x', startIndex: 0, endIndex: 1 }],
				safetySignals: [{ severity: 'red', kind: 'phone' }],
			}),
		)
		expect(d.band).toBe('blocklist')
	})

	it('Unsafe guard block still records orange safety signals in the verdict', () => {
		const d = decideModeration(
			input({
				safetySignals: [{ severity: 'orange', kind: 'intent_phrase' }],
				guard: guard('Unsafe'),
			}),
		)
		expect(d.band).toBe('guard_block')
		expect(d.verdict.safetySignals).toEqual([
			{ severity: 'orange', kind: 'intent_phrase' },
		])
	})
})

describe('decideModeration — an absent engine in shadow mode', () => {
	// A model that is missing, still loading, or failed to load never answers
	// until an operator acts, so fail-closed there is not a brief refusal —
	// it is permanent chat outage that reads as "the feature is broken". In
	// shadow mode the guard has no enforcement power anyway (an Unsafe
	// verdict publishes), so refusing when it cannot answer AT ALL is
	// strictly harsher than the case where it did object.
	it('publishes as review rather than refusing, and records why', () => {
		const d = decideModeration(
			input({ guard: { skipped: 'engine_not_ready' }, policy: DEFAULT_POLICY }),
		)

		expect(d.decision).toBe('allow')
		expect(d.band).toBe('review')
		// Never silent — the log still shows the model did not judge this.
		expect(d.verdict.guardSkipped).toBe('engine_not_ready')
	})

	it('still refuses an absent engine when actually enforcing', () => {
		const d = decideModeration(
			input({ guard: { skipped: 'engine_not_ready' }, policy: ENFORCE }),
		)

		expect(d.decision).toBe('reject')
		expect(d.band).toBe('guard_unavailable')
	})

	// The line is "could a retry ever succeed", not "is the guard missing".
	it('does not extend to transient skips, which are self-correcting on retry', () => {
		for (const skipped of ['deadline', 'backlog'] as const) {
			const d = decideModeration(
				input({ guard: { skipped }, policy: DEFAULT_POLICY }),
			)
			expect(d.decision).toBe('reject')
			expect(d.band).toBe('guard_unavailable')
		}
	})

	// The whole justification is that the tiers ahead of the guard still run.
	it('does not let a deterministic block through: threats still refuse', () => {
		const d = decideModeration(
			input({
				guard: { skipped: 'engine_not_ready' },
				threatMatches: [{ word: 'kill you', startIndex: 0, endIndex: 8 }],
				policy: DEFAULT_POLICY,
			}),
		)

		expect(d.decision).toBe('reject')
		expect(d.band).not.toBe('review')
	})
})

describe('decideModeration — guard absent / skipped (fail-closed)', () => {
	// Defect 1 regression: GuardInput has no bare-null variant, so no in-repo
	// caller can construct this today — but the core itself must not rely on
	// the type system alone. A stray null (cast past it, exactly the shape a
	// pre-fix shell used to hand over for "deliberately skipped judging")
	// must still fail closed, never fall through to allow/clean.
	it('a null guard with no deterministic tier resolved fails closed, never allow/clean (regression)', () => {
		const d = decideModeration(input({ guard: null as unknown as GuardInput }))
		expect(d.decision).not.toBe('allow')
		expect(d.band).not.toBe('clean')
		expect(d.band).toBe('guard_unavailable')
	})

	it('rejects with guard_unavailable when the judgement hit the deadline', () => {
		const g: GuardInput = { skipped: 'deadline' }
		const d = decideModeration(input({ guard: g }))
		expect(d.decision).toBe('reject')
		expect(d.band).toBe('guard_unavailable')
		expect(d.verdict.guardSkipped).toBe('deadline')
	})

	it('rejects a backlog short-circuit the same way, even in shadow mode', () => {
		const d = decideModeration(
			input({ guard: { skipped: 'backlog' }, policy: DEFAULT_POLICY }),
		)
		expect(d.decision).toBe('reject')
		expect(d.band).toBe('guard_unavailable')
		expect(d.verdict.guardSkipped).toBe('backlog')
	})

	it('skipped + orange safety still rejects and records both in the verdict', () => {
		const d = decideModeration(
			input({
				guard: { skipped: 'deadline' },
				safetySignals: [{ severity: 'orange', kind: 'intent_phrase' }],
			}),
		)
		expect(d.decision).toBe('reject')
		expect(d.band).toBe('guard_unavailable')
		expect(d.verdict.guardSkipped).toBe('deadline')
		expect(d.verdict.safetySignals).toEqual([
			{ severity: 'orange', kind: 'intent_phrase' },
		])
	})

	it('fails closed when the guard verdict carries an invalid safety value', () => {
		// `'safety' in guard` was not enough: a present-but-invalid value fell
		// through to the review branch and published unjudged.
		for (const bad of [undefined, null, 'safe', 'SAFE', 42, {}]) {
			const d = decideModeration(
				input({
					guard: { safety: bad, categories: [] } as unknown as GuardInput,
				}),
			)
			expect(d.decision).toBe('reject')
			expect(d.band).toBe('guard_unavailable')
		}
	})

	it('fails closed when the guard verdict has a malformed categories field', () => {
		for (const bad of [undefined, null, 'harassment', [1, 2]]) {
			const d = decideModeration(
				input({
					guard: { safety: 'Safe', categories: bad } as unknown as GuardInput,
				}),
			)
			expect(d.decision).toBe('reject')
			expect(d.band).toBe('guard_unavailable')
		}
	})

	it('is total for non-object guard values', () => {
		for (const bad of ['nonsense', 42, true, Symbol('x')]) {
			const d = decideModeration(input({ guard: bad as unknown as GuardInput }))
			expect(d.decision).toBe('reject')
			expect(d.band).toBe('guard_unavailable')
		}
	})

	it('never allows when the guard was not consulted and no deterministic tier fired (property)', () => {
		const arbSkippedGuard: fc.Arbitrary<GuardInput> = fc.oneof(
			fc
				.string({ minLength: 1, maxLength: 20 })
				.map((skipped): GuardInput => ({ skipped })),
			fc.constant(null as unknown as GuardInput),
		)
		fc.assert(
			fc.property(
				arbSkippedGuard,
				fc.array(
					fc.record({
						severity: fc.constantFrom('orange' as const),
						kind: fc.string({ minLength: 1, maxLength: 20 }),
					}),
					{ maxLength: 3 },
				),
				fc.boolean(),
				(skippedGuard, safetySignals, shadowMode) => {
					const d = decideModeration(
						input({
							guard: skippedGuard,
							safetySignals,
							policy: { ...ENFORCE, shadowMode },
							isAllowlisted: false,
							threatMatches: [],
							obscenityMatches: [],
						}),
					)
					expect(d.decision).not.toBe('allow')
					expect(d.band).toBe('guard_unavailable')
				},
			),
		)
	})
})

// Scenario table: guard verdicts measured on the real chat export (ADR-4 eval).
// Banter and game vocabulary must publish; targeted filth must not.
describe('decideModeration — real-traffic scenarios', () => {
	const cases: Array<{
		name: string
		guard: GuardInput
		expectReject: boolean
	}> = [
		{
			name: 'did you die to a blind? (game vocab — guard says Safe)',
			guard: { safety: 'Safe' },
			expectReject: false,
		},
		{
			name: 'you suck lol (banter — guard says Controversial)',
			guard: { safety: 'Controversial' },
			expectReject: false,
		},
		{
			name: 'im gonna kill myself (self-harm — Unsafe, must not publish silently)',
			guard: { safety: 'Unsafe' },
			expectReject: true,
		},
		{
			name: 'targeted slur (Unsafe)',
			guard: { safety: 'Unsafe' },
			expectReject: true,
		},
	]
	for (const c of cases) {
		it(c.name, () => {
			const d = decideModeration(input({ guard: c.guard }))
			expect(d.decision === 'reject').toBe(c.expectReject)
		})
	}
})

describe('decideModeration — totality property', () => {
	it('never throws and always returns a valid decision for arbitrary input', () => {
		const arbGuard: fc.Arbitrary<GuardInput> = fc.oneof(
			fc.record({
				safety: fc.constantFrom<GuardSafetyLevel>(
					'Safe',
					'Unsafe',
					'Controversial',
					'unknown',
				),
				categories: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
					maxLength: 3,
				}),
			}),
			fc.constant({ skipped: 'error' }),
		)

		fc.assert(
			fc.property(
				fc.string(),
				fc.integer({ min: 0, max: 10_000_000 }),
				arbGuard,
				fc.boolean(),
				fc.boolean(),
				fc.array(
					fc.record({
						severity: fc.constantFrom('red' as const, 'orange' as const),
						kind: fc.string({ minLength: 1, maxLength: 20 }),
					}),
					{ maxLength: 3 },
				),
				(message, nowMs, g, isAllowlisted, shadowMode, safetySignals) => {
					const d = decideModeration({
						message,
						nowMs,
						isAllowlisted,
						threatMatches: [],
						obscenityMatches: [],
						safetySignals,
						guard: g,
						policy: { ...DEFAULT_POLICY, shadowMode },
					})
					expect(['allow', 'reject']).toContain(d.decision)
					// shadow mode never rejects on guard-VERDICT grounds; availability
					// (guard_unavailable) fails closed regardless of shadow.
					if (shadowMode && d.decision === 'reject') {
						expect([
							'blocklist',
							'safety_block',
							'guard_unavailable',
						]).toContain(d.band)
					}
					// an Unsafe verdict in enforce mode must never land in clean
					if (
						!shadowMode &&
						'safety' in g &&
						g.safety === 'Unsafe' &&
						!isAllowlisted &&
						safetySignals.every((s) => s.severity !== 'red')
					) {
						expect(d.band).toBe('guard_block')
					}
					// unknown must never be clean (only preset/deterministic may skip review)
					if (
						'safety' in g &&
						g.safety === 'unknown' &&
						!isAllowlisted &&
						safetySignals.length === 0
					) {
						expect(d.band).toBe('review')
					}
				},
			),
		)
	})
})
