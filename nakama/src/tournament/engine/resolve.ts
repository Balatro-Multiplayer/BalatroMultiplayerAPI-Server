// Works out every match's players, status and outcome from the bracket's slots
// and the results recorded so far. Matches are listed so that every slot
// refers to an earlier match (each generator builds them in that order), so a
// single pass resolves everything.
import type {
	Bracket,
	Decision,
	EntrantId,
	GameOutcome,
	MatchDef,
	Outcome,
	OutcomeReason,
	ResolvedBracket,
	ResolvedMatch,
	Side,
	SlotSource,
	Stage,
} from './types'

type Player = EntrantId | null | undefined

// Elimination never ends a series on a draw: a drawn game is replayed. Round
// robin and Swiss count a drawn game as played, and a series can end level.
export function drawsCount(stage: Stage): boolean {
	return stage === 'RR' || stage === 'SW'
}

export function winsNeeded(bestOf: number): number {
	return Math.floor(bestOf / 2) + 1
}

export function gameWins(games: GameOutcome[]): [number, number] {
	const wins: [number, number] = [0, 0]
	for (const g of games) if (g !== 'draw') wins[g]++
	return wins
}

// The series result from its games: a side, a draw, or null while undecided.
export function seriesResult(games: GameOutcome[], bestOf: number, stage: Stage): Side | 'draw' | null {
	const wins = gameWins(games)
	const need = winsNeeded(bestOf)
	if (wins[0] >= need) return 0
	if (wins[1] >= need) return 1
	if (drawsCount(stage) && games.length >= bestOf) {
		if (wins[0] > wins[1]) return 0
		if (wins[1] > wins[0]) return 1
		return 'draw'
	}
	return null
}

function outcomeFor(players: [EntrantId | null, EntrantId | null], result: Side | 'draw' | 'none', reason: OutcomeReason): Outcome {
	if (result === 'draw') return { winner: null, loser: null, winnerSide: null, draw: true, reason }
	if (result === 'none') return { winner: null, loser: null, winnerSide: null, draw: false, reason }
	return { winner: players[result], loser: players[result === 0 ? 1 : 0], winnerSide: result, draw: false, reason }
}

function samePair(a: [EntrantId, EntrantId] | undefined, b: [Player, Player]): boolean {
	return a !== undefined && a[0] === b[0] && a[1] === b[1]
}

function decisionResult(decision: Decision): Side | 'draw' | 'none' {
	if (decision.kind === 'forfeit') return decision.winner
	if (decision.kind === 'double_forfeit') return 'none'
	return decision.outcome
}

function slotPlayer(source: SlotSource, seeds: EntrantId[], byId: { [id: string]: ResolvedMatch }): Player {
	switch (source.kind) {
		case 'seed':
			return source.seed >= 1 && source.seed <= seeds.length ? seeds[source.seed - 1] : null
		case 'entrant':
			return source.id
		case 'bye':
			return null
		case 'winner':
		case 'loser': {
			const from = byId[source.matchId]
			if (!from || !from.outcome) return undefined
			if (from.outcome.draw) return null
			return source.kind === 'winner' ? from.outcome.winner : from.outcome.loser
		}
	}
}

function resolveMatch(def: MatchDef, bracket: Bracket, dropped: Set<EntrantId>, byId: { [id: string]: ResolvedMatch }): ResolvedMatch {
	const base: ResolvedMatch = { def, players: [undefined, undefined], status: 'waiting', wins: [0, 0], outcome: null, stale: false }
	if (def.onlyIf) {
		const gate = byId[def.onlyIf.matchId]
		if (!gate || !gate.outcome) return base
		if (gate.outcome.winnerSide !== def.onlyIf.winner) return { ...base, status: 'void' }
	}
	const players: [Player, Player] = [slotPlayer(def.slots[0], bracket.seeds, byId), slotPlayer(def.slots[1], bracket.seeds, byId)]
	base.players = players
	const recorded = def.games.length > 0 || def.decision !== undefined
	const current = samePair(def.playedBy, players)
	const stale = recorded && !current
	base.stale = stale

	if (players[0] === undefined || players[1] === undefined) return base
	const known: [EntrantId | null, EntrantId | null] = [players[0], players[1]]

	// Byes: one side empty advances the other; both empty advances nobody.
	if (known[0] === null || known[1] === null) {
		const result: Side | 'none' = known[0] !== null ? 0 : known[1] !== null ? 1 : 'none'
		return { ...base, status: 'done', outcome: outcomeFor(known, result, 'bye') }
	}

	const games = current ? def.games : []
	const wins = gameWins(games)
	base.wins = wins

	if (current && def.decision) {
		const reason: OutcomeReason = def.decision.kind === 'override' ? 'override' : def.decision.kind
		return { ...base, status: 'done', outcome: outcomeFor(known, decisionResult(def.decision), reason) }
	}

	const series = seriesResult(games, def.bestOf, def.stage)
	if (series !== null) return { ...base, status: 'done', outcome: outcomeFor(known, series, 'played') }

	// A dropped player forfeits every match they haven't finished.
	const gone: [boolean, boolean] = [dropped.has(known[0]), dropped.has(known[1])]
	if (gone[0] || gone[1]) {
		const result: Side | 'none' = gone[0] && gone[1] ? 'none' : gone[0] ? 1 : 0
		return { ...base, status: 'done', outcome: outcomeFor(known, result, 'dropped') }
	}

	return { ...base, status: games.length > 0 ? 'in_progress' : 'ready' }
}

export function resolveBracket(bracket: Bracket, dropped: EntrantId[] = []): ResolvedBracket {
	const droppedSet = new Set(dropped)
	const byId: { [id: string]: ResolvedMatch } = {}
	const matches: ResolvedMatch[] = []
	for (const def of bracket.matches) {
		const resolved = resolveMatch(def, bracket, droppedSet, byId)
		byId[def.id] = resolved
		matches.push(resolved)
	}
	return { matches, byId }
}
