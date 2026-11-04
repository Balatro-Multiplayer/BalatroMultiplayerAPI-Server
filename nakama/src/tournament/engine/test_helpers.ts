// Shared by the engine tests: entrant ids and a driver that plays a bracket
// to the end.
import { type Rng, seededRng } from './seeding'
import { isFinished, nextSwissRound, recordGame } from './bracket'
import { resolveBracket } from './resolve'
import type { Bracket, EntrantId, GameOutcome, ResolvedMatch } from './types'

export function players(n: number): EntrantId[] {
	const out: EntrantId[] = []
	for (let i = 1; i <= n; i++) out.push(`p${i}`)
	return out
}

export type Picker = (match: ResolvedMatch, bracket: Bracket) => GameOutcome

// The better seed (lower number) wins every game.
export const favourite: Picker = (match, bracket) => {
	const [a, b] = match.players as [EntrantId, EntrantId]
	return bracket.seeds.indexOf(a) < bracket.seeds.indexOf(b) ? 0 : 1
}

export function randomWinner(rng: Rng): Picker {
	return () => (rng() < 0.5 ? 0 : 1)
}

export { seededRng }

// Plays every ready match (one game at a time) until nothing is left to play,
// pairing Swiss rounds as they finish. Throws on any refusal.
export function playOut(start: Bracket, pick: Picker, dropped: EntrantId[] = []): Bracket {
	let bracket = start
	for (let guard = 0; guard < 100000; guard++) {
		const ready = resolveBracket(bracket, dropped).matches.find((m) => m.status === 'ready' || m.status === 'in_progress')
		if (ready) {
			const next = recordGame(bracket, ready.def.id, pick(ready, bracket), dropped)
			if (!next.ok) throw new Error(`${next.error.code}: ${next.error.message}`)
			bracket = next.value
			continue
		}
		if (bracket.format === 'swiss' && !isFinished(bracket, dropped)) {
			const next = nextSwissRound(bracket, dropped)
			if (!next.ok) throw new Error(`${next.error.code}: ${next.error.message}`)
			bracket = next.value
			continue
		}
		return bracket
	}
	throw new Error('playOut did not finish')
}
