import { describe, expect, it } from 'vitest'
import { previewTournament } from './preview'

const NOW = Date.UTC(2026, 10, 7, 12, 0)
const settings = (extra: object = {}) => ({
	format: 'single_elim',
	rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 3 } },
	timetable: { kind: 'preset', preset: 'live_event', options: {} },
	...extra,
})

function preview(extra: object, players: number, step: number) {
	const r = previewTournament(settings(extra), players, step, NOW)
	if (!r.ok) throw new Error(r.error)
	return r.value
}

const done = (p: ReturnType<typeof preview>) => p.tournament.bracket!.filter((m) => m.status === 'done' && m.outcome?.reason === 'played').length

describe('the create wizard preview', () => {
	it('builds the bracket with Player 1 as the top seed and nothing played', () => {
		const p = preview({}, 8, 0)
		expect(p.steps).toBe(3)
		expect(p.step).toBe(0)
		expect(p.tournament.bracket![0].players).toEqual([
			{ id: 'preview-1', name: 'Player 1' },
			{ id: 'preview-8', name: 'Player 8' },
		])
		expect(done(p)).toBe(0)
		expect(p.tournament.bracket![0].clock).toBeNull()
	})

	it('plays one round per step, up to the end', () => {
		expect(done(preview({}, 8, 1))).toBe(4)
		expect(done(preview({}, 8, 2))).toBe(6)
		const end = preview({}, 8, 99)
		expect(end.step).toBe(3)
		expect(done(end)).toBe(7)
		expect(end.tournament.placements!.length).toBeGreaterThan(0)
		// Best of 3: every played match ended 2 to something.
		for (const m of end.tournament.bracket!) expect(Math.max(...m.wins)).toBe(2)
	})

	it('is the same every time (rewinding shows the same results)', () => {
		expect(JSON.stringify(preview({}, 13, 2))).toBe(JSON.stringify(preview({}, 13, 2)))
		const a = preview({}, 13, 3).tournament.bracket!.filter((m) => m.round <= 2)
		const b = preview({}, 13, 2).tournament.bracket!.filter((m) => m.round <= 2)
		expect(a.map((m) => m.wins)).toEqual(b.map((m) => m.wins))
	})

	it('shows each round its own settings', () => {
		const p = preview({ rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 }, overrides: { R2: { deck: { kind: 'locked', deck: 'b_black', stake: 7 } }, FINAL: { bestOf: 5 } } } }, 8, 3)
		const round = (r: number) => p.tournament.bracket!.find((m) => m.round === r)!
		expect(round(1).deck).toBeNull()
		expect(round(2).deck).toEqual({ kind: 'locked', deck: 'b_black', stake: 7 })
		expect(round(3).bestOf).toBe(5)
	})

	it('works for every format', () => {
		const de = preview({ format: 'double_elim', formatOptions: { grandFinalReset: true } }, 8, 99)
		expect(de.steps).toBe(7)
		expect(de.tournament.bracket!.every((m) => m.status === 'done' || m.status === 'void')).toBe(true)
		const rr = preview({ format: 'round_robin', formatOptions: { groupSize: 4 } }, 8, 99)
		expect(rr.steps).toBe(3)
		expect(rr.tournament.standings!.length).toBe(2)
		const swiss = preview({ format: 'swiss' }, 7, 99)
		expect(swiss.steps).toBe(3)
		expect(swiss.tournament.bracket!.filter((m) => m.stage === 'SW' && m.round === 3).length).toBe(4)
	})

	it('refuses impossible counts', () => {
		expect(previewTournament(settings(), 1, 0, NOW).ok).toBe(false)
		expect(previewTournament(settings(), 129, 0, NOW).ok).toBe(false)
		expect(previewTournament(settings({ format: 'nope' }), 8, 0, NOW).ok).toBe(false)
	})
})
