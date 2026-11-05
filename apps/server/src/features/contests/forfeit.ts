// A withdrawn in-game Contest is the contester's forfeit. The contester takes
// the last place; the others keep the order they had before the Contest (the
// result reported before it), or share first place when nobody reported one.
// In a match of 2 that makes the opponent the winner.
import type { Placement } from '../service-queue/overturn.js'

export function forfeitPlacements(
	participants: readonly string[],
	original: readonly Placement[],
	contesterId: string,
): Placement[] | null {
	if (participants.length < 2 || !participants.includes(contesterId)) return null
	const others = participants.filter((id) => id !== contesterId)
	const before = new Map(original.map((p) => [p.playerId, p.place]))
	const known = others.every((id) => before.has(id))
	// Dense places, ties kept: 1, 1, 2 stays 1, 1, 2 whatever gap the contester left.
	const distinct = known ? [...new Set(others.map((id) => before.get(id) as number))].sort((a, b) => a - b) : [1]
	const placed = others.map((playerId) => ({
		playerId,
		place: known ? distinct.indexOf(before.get(playerId) as number) + 1 : 1,
	}))
	return [...placed, { playerId: contesterId, place: distinct.length + 1 }]
}
