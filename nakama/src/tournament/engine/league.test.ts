import { describe, expect, it } from 'vitest'
import { createBracket, decideMatch, isFinished, nextSwissRound, finalPlacements, recordGame } from './bracket'
import { resolveBracket } from './resolve'
import { circlePairings, splitGroups } from './round_robin'
import { computeStandings } from './standings'
import { defaultSwissRounds } from './swiss'
import { favourite, playOut, players, randomWinner, seededRng } from './test_helpers'
import type { Bracket, ResolvedMatch } from './types'

function build(format: 'round_robin' | 'swiss', n: number, options = {}, bestOf = 1): Bracket {
	const r = createBracket(format, players(n), options, bestOf)
	if (!r.ok) throw new Error(r.error.message)
	return r.value
}

function playersOf(ms: ResolvedMatch[]): (string | null | undefined)[] {
	return ms.reduce<(string | null | undefined)[]>((all, m) => all.concat(m.players), [])
}

function pairKey(m: ResolvedMatch): string {
	return [m.players[0], m.players[1]].sort().join('|')
}

describe('round robin', () => {
	it('splits groups in snake order, as even as possible', () => {
		expect(splitGroups(players(8), 4)).toEqual([
			['p1', 'p4', 'p5', 'p8'],
			['p2', 'p3', 'p6', 'p7'],
		])
		// p10 is where the snake turns back, so the third group gets the extra player.
		expect(splitGroups(players(10), 4).map((g) => g.length)).toEqual([3, 3, 4])
	})

	it('refuses a group size that leaves someone alone', () => {
		expect(createBracket('round_robin', players(3), { groupSize: 2 }).ok).toBe(false)
	})

	for (const [n, size] of [
		[2, 2],
		[3, 3],
		[5, 5],
		[8, 4],
		[9, 4],
		[16, 6],
		[33, 8],
		[128, 8],
	]) {
		it(`pairs everyone in a group exactly once (${n} players, groups of ${size})`, () => {
			const b = build('round_robin', n, { groupSize: size })
			const groups = splitGroups(players(n), size)
			const r = resolveBracket(b)
			groups.forEach((members, g) => {
				const ms = r.matches.filter((m) => m.def.group === g + 1)
				expect(ms.length).toBe((members.length * (members.length - 1)) / 2)
				expect(new Set(ms.map(pairKey)).size).toBe(ms.length)
				// Nobody plays twice in one round.
				const rounds = new Set(ms.map((m) => m.def.round))
				for (const round of rounds) {
					const inRound = playersOf(ms.filter((m) => m.def.round === round))
					expect(new Set(inRound).size).toBe(inRound.length)
				}
			})
			const done = playOut(b, randomWinner(seededRng(n)))
			expect(isFinished(done)).toBe(true)
			expect(finalPlacements(done).length).toBe(n)
		})
	}

	it('circle method gives every player one rest round with an odd group', () => {
		const rounds = circlePairings(players(5))
		expect(rounds.length).toBe(5)
		for (const round of rounds) expect(round.length).toBe(2)
	})

	it('ranks by points, then game wins, then head-to-head, then seed', () => {
		// Bo3. p1 beats p2 2-0, p2 beats p3 2-1, p3 beats p1 2-0:
		// everyone 1 point; game wins p3 3, p1 2, p2 2 -> p3 first, then
		// p1/p2 tied on 2 and p1 beat p2 head-to-head.
		let b = build('round_robin', 3, {}, 3)
		const play = (id: string, games: (0 | 1)[]) => {
			for (const g of games) {
				const next = recordGame(b, id, g)
				if (!next.ok) throw new Error(next.error.message)
				b = next.value
			}
		}
		const r = resolveBracket(b)
		const find = (x: string, y: string) => r.matches.find((m) => pairKey(m) === [x, y].sort().join('|'))?.def as Bracket['matches'][number]
		const m12 = find('p1', 'p2')
		const m23 = find('p2', 'p3')
		const m13 = find('p1', 'p3')
		const side = (m: typeof m12, winner: string) => (m.slots[0].kind === 'entrant' && m.slots[0].id === winner ? 0 : 1)
		play(m12.id, [side(m12, 'p1'), side(m12, 'p1')])
		play(m23.id, [side(m23, 'p2'), side(m23, 'p3'), side(m23, 'p2')])
		play(m13.id, [side(m13, 'p3'), side(m13, 'p3')])
		expect(finalPlacements(b).map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
	})

	it('counts a drawn Bo1 as half a point each', () => {
		let b = build('round_robin', 2)
		const next = recordGame(b, b.matches[0].id, 'draw')
		if (!next.ok) throw new Error(next.error.message)
		b = next.value
		const rows = computeStandings(b.seeds, resolveBracket(b).matches, ['seed'])
		expect(rows.map((r) => r.points)).toEqual([0.5, 0.5])
		expect(isFinished(b)).toBe(true)
	})
})

describe('swiss', () => {
	it('defaults to enough rounds for one unbeaten player', () => {
		expect([2, 3, 8, 9, 32, 128].map(defaultSwissRounds)).toEqual([1, 2, 3, 4, 5, 7])
	})

	it('pairs round 1 top half against bottom half', () => {
		const b = build('swiss', 8)
		expect(resolveBracket(b).matches.map((m) => m.players)).toEqual([
			['p1', 'p5'],
			['p2', 'p6'],
			['p3', 'p7'],
			['p4', 'p8'],
		])
	})

	it('waits for the current round before pairing the next', () => {
		const b = build('swiss', 8)
		const r = nextSwissRound(b)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error.code).toBe('round_unfinished')
	})

	const sizes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 24, 31, 32, 33, 50, 64, 65, 100, 127, 128]
	for (const n of sizes) {
		it(`plays out with ${n} players: no rematches, at most one bye each`, () => {
			const b = playOut(build('swiss', n), randomWinner(seededRng(1000 + n)))
			expect(isFinished(b)).toBe(true)
			const r = resolveBracket(b)
			const real = r.matches.filter((m) => typeof m.players[1] === 'string')
			expect(new Set(real.map(pairKey)).size).toBe(real.length)
			const byes: { [id: string]: number } = {}
			for (const m of r.matches) if (m.players[1] === null) byes[m.players[0] as string] = (byes[m.players[0] as string] ?? 0) + 1
			for (const count of Object.values(byes)) expect(count).toBe(1)
			// Each round, every player plays (or rests) exactly once.
			for (let round = 1; round <= (b.options.swissRounds ?? 0); round++) {
				const seen = playersOf(r.matches.filter((m) => m.def.round === round)).filter((p) => typeof p === 'string')
				expect(seen.length).toBe(n)
				expect(new Set(seen).size).toBe(n)
			}
			const places = finalPlacements(b)
			expect(places.map((p) => p.place)).toEqual(players(n).map((_, i) => i + 1))
		})
	}

	it('leaves a dropped player out of later rounds', () => {
		let b = build('swiss', 8)
		b = playOut(b, favourite, ['p8'])
		const r = resolveBracket(b, ['p8'])
		const p8 = r.matches.filter((m) => m.players.includes('p8'))
		expect(p8.length).toBe(1)
		expect(p8[0].outcome?.reason).toBe('dropped')
	})

	it('ranks with Buchholz before head-to-head', () => {
		const b = playOut(build('swiss', 8), favourite)
		const rows = computeStandings(b.seeds, resolveBracket(b).matches, ['buchholz', 'head_to_head', 'seed'])
		expect(rows[0].id).toBe('p1')
		expect(rows[0].points).toBe(3)
		for (let i = 1; i < rows.length; i++) {
			const prev = rows[i - 1]
			const row = rows[i]
			expect(prev.points > row.points || (prev.points === row.points && prev.buchholz >= row.buchholz)).toBe(true)
		}
	})

	it('scores a double forfeit as a loss for both', () => {
		const b = build('swiss', 4)
		const r = decideMatch(b, 'SW1-1', { kind: 'double_forfeit' })
		if (!r.ok) throw new Error(r.error.message)
		const rows = computeStandings(b.seeds, resolveBracket(r.value).matches, ['seed'])
		const loser = rows.filter((row) => row.losses === 1)
		expect(loser.map((row) => row.id).sort()).toEqual(['p1', 'p3'])
	})
})
