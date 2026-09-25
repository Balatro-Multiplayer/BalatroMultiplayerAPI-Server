import { describe, expect, it } from 'vitest'
import { createDeterministicAnalyzer } from './analyze.js'

const analyzer = createDeterministicAnalyzer()

// Slur fixtures are assembled from code points, not written literally, so this
// (public) repo carries no slur in its source text. The analyzer still receives
// the real word at runtime — that is exactly what these tests verify.
const slur = (...codes: number[]): string => String.fromCharCode(...codes)
const SLUR_ABLEIST = slur(114, 101, 116, 97, 114, 100) // r-slur
const SLUR_HOMOPHOBIC_LEET = slur(102, 52, 103, 103, 48, 116) // f-slur, leetspeak

describe('createDeterministicAnalyzer', () => {
	it('catches denylist phrases through leetspeak variants', () => {
		const e = analyzer.analyze('k1ll y0urs3lf')
		expect(e.obscenityMatches.some((m) => m.word === 'kill yourself')).toBe(
			true,
		)
	})

	it('catches denylist phrases through stretched letters', () => {
		const e = analyzer.analyze('kiiiill yourseeeelf')
		expect(e.obscenityMatches.some((m) => m.word === 'kill yourself')).toBe(
			true,
		)
	})

	it('catches 1-as-l leetspeak and self-harm euphemisms', () => {
		for (const msg of ['ki11 yourself', 'unalive yourself', 'go unalive']) {
			expect(
				analyzer.analyze(msg).obscenityMatches.length,
				msg,
			).toBeGreaterThan(0)
		}
	})

	it('flags severe obscenity (slurs) on the raw text', () => {
		const e = analyzer.analyze(`shut up you ${SLUR_ABLEIST}`)
		expect(e.obscenityMatches.length).toBeGreaterThan(0)
	})

	it('does NOT flag banter-grade profanity — the guard judges it in context', () => {
		for (const msg of [
			'fuck this game',
			'you worthless piece of shit',
			'im so ass',
			'that run was bitch hard',
		]) {
			const e = analyzer.analyze(msg)
			expect(e.obscenityMatches).toEqual([])
		}
	})

	it('still hard-blocks slurs through leetspeak variants', () => {
		const e = analyzer.analyze(`you are a ${SLUR_HOMOPHOBIC_LEET}`)
		expect(e.obscenityMatches.length).toBeGreaterThan(0)
	})

	it('surfaces directed violent threats the guard underrates', () => {
		const e = analyzer.analyze('i will execute your family')
		expect(e.threatMatches.length).toBeGreaterThan(0)
	})

	it('does NOT flag game-speak that shares threat verbs', () => {
		for (const msg of [
			'execute the combo',
			"i'll kill this run",
			'destroy you',
		]) {
			expect(analyzer.analyze(msg).threatMatches).toEqual([])
		}
	})

	it('produces safety signals for contact exchange', () => {
		const e = analyzer.analyze('add me on discord mycoolname')
		expect(e.safetySignals.length).toBeGreaterThan(0)
	})

	it('returns clean evidence for clean game talk', () => {
		const e = analyzer.analyze('that flush build was crazy, one more?')
		expect(e.obscenityMatches).toEqual([])
		expect(e.safetySignals).toEqual([])
	})

	it('de-duplicates matches across variants', () => {
		const e = analyzer.analyze('kys kys kys')
		const denyHits = e.obscenityMatches.filter((m) => m.word === 'kys')
		expect(denyHits.length).toBe(1)
	})
})
