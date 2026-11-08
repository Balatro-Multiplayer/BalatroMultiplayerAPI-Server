// Single- and double-elimination brackets. The bracket is sized to the next
// power of two; seeds past the entrant count are byes, which resolve.ts turns
// into automatic advances. Seeds are placed the standard way (1 v 8, 4 v 5,
// 2 v 7, 3 v 6 for eight), so the top seeds get the byes and can only meet
// late.
import type { MatchDef, SlotSource } from './types'

export function bracketSize(entrants: number): number {
	let size = 2
	while (size < entrants) size *= 2
	return size
}

// Seed numbers in bracket order: consecutive pairs play each other in round 1.
export function seedOrder(size: number): number[] {
	let order = [1]
	for (let length = 1; length < size; length *= 2) {
		const next: number[] = []
		const sum = length * 2 + 1
		for (const seed of order) next.push(seed, sum - seed)
		order = next
	}
	return order
}

function matchDef(id: string, stage: MatchDef['stage'], round: number, order: number, slots: [SlotSource, SlotSource], bestOf: number): MatchDef {
	return { id, stage, round, order, slots, bestOf, games: [] }
}

export function winnersId(round: number, order: number): string {
	return `W${round}-${order}`
}

export function losersId(round: number, order: number): string {
	return `L${round}-${order}`
}

// The winners bracket: log2(size) rounds, the last one its final.
function winnersBracket(entrants: number, bestOf: number): { matches: MatchDef[]; rounds: number; size: number } {
	const size = bracketSize(entrants)
	const order = seedOrder(size)
	const matches: MatchDef[] = []
	let rounds = 0
	for (let n = size; n > 1; n /= 2) rounds++
	for (let i = 0; i < size / 2; i++) {
		matches.push(matchDef(winnersId(1, i + 1), 'W', 1, i + 1, [{ kind: 'seed', seed: order[2 * i] }, { kind: 'seed', seed: order[2 * i + 1] }], bestOf))
	}
	for (let round = 2; round <= rounds; round++) {
		const count = size / 2 ** round
		for (let i = 1; i <= count; i++) {
			matches.push(
				matchDef(
					winnersId(round, i),
					'W',
					round,
					i,
					[
						{ kind: 'winner', matchId: winnersId(round - 1, 2 * i - 1) },
						{ kind: 'winner', matchId: winnersId(round - 1, 2 * i) },
					],
					bestOf,
				),
			)
		}
	}
	return { matches, rounds, size }
}

export function singleElimination(entrants: number, bestOf = 1): MatchDef[] {
	return winnersBracket(entrants, bestOf).matches
}

// Losers-bracket position a winners-round loser drops into. Alternating the
// direction keeps players who met in the winners bracket apart for as long
// as possible.
function dropIn(winnersRound: number, position: number, count: number): number {
	const j = winnersRound - 1
	return j % 2 === 1 ? count + 1 - position : position
}

// Double elimination: the winners bracket, a losers bracket of 2*(rounds-1)
// rounds, and a grand final between the two bracket winners. With
// grandFinalReset, a second grand final is played when the losers-bracket
// player wins the first (GF2 is void otherwise).
//
// Losers round 1 pairs the losers of winners round 1. Each even losers round
// 2j pits the survivors against the losers of winners round j+1; each odd
// round after that halves the field.
export function doubleElimination(entrants: number, options: { bestOf?: number; grandFinalReset?: boolean } = {}): MatchDef[] {
	const bestOf = options.bestOf ?? 1
	const { matches, rounds, size } = winnersBracket(entrants, bestOf)
	const winnersFinal = winnersId(rounds, 1)

	let losersFinal: string | null = null
	if (rounds >= 2) {
		const firstCount = size / 4
		for (let i = 1; i <= firstCount; i++) {
			matches.push(
				matchDef(
					losersId(1, i),
					'L',
					1,
					i,
					[
						{ kind: 'loser', matchId: winnersId(1, 2 * i - 1) },
						{ kind: 'loser', matchId: winnersId(1, 2 * i) },
					],
					bestOf,
				),
			)
		}
		for (let j = 1; j <= rounds - 1; j++) {
			const evenRound = 2 * j
			const count = size / 2 ** (j + 1)
			for (let i = 1; i <= count; i++) {
				matches.push(
					matchDef(
						losersId(evenRound, i),
						'L',
						evenRound,
						i,
						[
							{ kind: 'winner', matchId: losersId(evenRound - 1, i) },
							{ kind: 'loser', matchId: winnersId(j + 1, dropIn(j + 1, i, count)) },
						],
						bestOf,
					),
				)
			}
			if (j < rounds - 1) {
				const oddRound = evenRound + 1
				for (let i = 1; i <= count / 2; i++) {
					matches.push(
						matchDef(
							losersId(oddRound, i),
							'L',
							oddRound,
							i,
							[
								{ kind: 'winner', matchId: losersId(evenRound, 2 * i - 1) },
								{ kind: 'winner', matchId: losersId(evenRound, 2 * i) },
							],
							bestOf,
						),
					)
				}
			}
		}
		losersFinal = losersId(2 * (rounds - 1), 1)
	}

	// Two entrants: the winners final's loser goes straight to the grand final.
	const challenger: SlotSource = losersFinal ? { kind: 'winner', matchId: losersFinal } : { kind: 'loser', matchId: winnersFinal }
	matches.push(matchDef('GF1', 'GF', 1, 1, [{ kind: 'winner', matchId: winnersFinal }, challenger], bestOf))
	if (options.grandFinalReset ?? true) {
		const reset = matchDef('GF2', 'GF', 2, 1, [{ kind: 'loser', matchId: 'GF1' }, { kind: 'winner', matchId: 'GF1' }], bestOf)
		reset.onlyIf = { matchId: 'GF1', winner: 1 }
		matches.push(reset)
	}
	return matches
}
