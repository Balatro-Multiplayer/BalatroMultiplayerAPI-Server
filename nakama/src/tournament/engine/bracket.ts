// What the rest of the server does to a bracket: build it, record games and
// decisions, apply organiser corrections, pair the next Swiss round, read the
// final placings. Every function returns a new Bracket and leaves its input
// untouched.
import { type Result, err, ok } from '../../shared/result'
import { doubleElimination, singleElimination } from './elimination'
import { drawsCount, resolveBracket } from './resolve'
import { roundRobin, splitGroups } from './round_robin'
import { DEFAULT_TIEBREAKERS, computeStandings } from './standings'
import { type SwissPlayer, defaultSwissRounds, pairSwissRound } from './swiss'
import type {
	Bracket,
	BracketOptions,
	Decision,
	EngineError,
	EntrantId,
	Format,
	GameOutcome,
	MatchDef,
	ResolvedBracket,
	ResolvedMatch,
	Stage,
	Tiebreaker,
} from './types'

export const MIN_ENTRANTS = 2
export const MAX_ENTRANTS = 128
export const BEST_OF_CHOICES = [1, 3, 5, 7]

export function tiebreakersFor(bracket: Bracket): Tiebreaker[] {
	if (bracket.options.tiebreakers) return bracket.options.tiebreakers
	return bracket.format === 'swiss' ? DEFAULT_TIEBREAKERS.swiss : DEFAULT_TIEBREAKERS.round_robin
}

// Builds the bracket for entrants already in seed order. Swiss starts with its
// first round only; nextSwissRound adds the rest.
export function createBracket(format: Format, seeded: EntrantId[], options: BracketOptions = {}, bestOf = 1): Result<Bracket, EngineError> {
	if (seeded.length < MIN_ENTRANTS) return err({ code: 'too_few_entrants', message: `At least ${MIN_ENTRANTS} entrants are needed` })
	if (seeded.length > MAX_ENTRANTS) return err({ code: 'invalid', message: `At most ${MAX_ENTRANTS} entrants` })
	if (new Set(seeded).size !== seeded.length) return err({ code: 'invalid', message: 'Entrants must be unique' })
	if (BEST_OF_CHOICES.indexOf(bestOf) === -1) return err({ code: 'invalid', message: 'bestOf must be 1, 3, 5 or 7' })
	const seeds = seeded.slice()
	switch (format) {
		case 'single_elim':
			return ok({ format, seeds, options: { ...options }, matches: singleElimination(seeds.length, bestOf) })
		case 'double_elim': {
			const opts = { ...options, grandFinalReset: options.grandFinalReset ?? true }
			return ok({ format, seeds, options: opts, matches: doubleElimination(seeds.length, { bestOf, grandFinalReset: opts.grandFinalReset }) })
		}
		case 'round_robin': {
			const groupSize = options.groupSize ?? seeds.length
			if (groupSize < 2) return err({ code: 'invalid', message: 'Groups need at least 2 players' })
			const groups = splitGroups(seeds, groupSize)
			if (groups.some((g) => g.length < 2)) return err({ code: 'invalid', message: 'That group size leaves a group with one player' })
			return ok({ format, seeds, options: { ...options, groupSize }, matches: roundRobin(seeds, { groupSize, bestOf }) })
		}
		case 'swiss': {
			const swissRounds = options.swissRounds ?? defaultSwissRounds(seeds.length)
			if (swissRounds < 1 || swissRounds >= seeds.length) {
				return err({ code: 'invalid', message: 'Swiss needs at least 1 round and fewer rounds than players' })
			}
			const players: SwissPlayer[] = seeds.map((id, i) => ({ id, seed: i + 1, points: 0, hadBye: false, opponents: [] }))
			return ok({ format, seeds, options: { ...options, swissRounds }, matches: pairSwissRound(players, 1, bestOf) })
		}
	}
}

function replaceMatch(bracket: Bracket, def: MatchDef): Bracket {
	return { ...bracket, matches: bracket.matches.map((m) => (m.id === def.id ? def : m)) }
}

function playable(resolved: ResolvedMatch): resolved is ResolvedMatch & { players: [EntrantId, EntrantId] } {
	return (resolved.status === 'ready' || resolved.status === 'in_progress') && typeof resolved.players[0] === 'string' && typeof resolved.players[1] === 'string'
}

function findMatch(bracket: Bracket, matchId: string, dropped: EntrantId[]): Result<{ resolved: ResolvedBracket; match: ResolvedMatch }, EngineError> {
	const resolved = resolveBracket(bracket, dropped)
	const match = resolved.byId[matchId]
	if (!match) return err({ code: 'unknown_match', message: `No match ${matchId}` })
	return ok({ resolved, match })
}

// Records one finished game. In elimination a draw is replayed: it is kept
// in the log but decides nothing.
export function recordGame(bracket: Bracket, matchId: string, outcome: GameOutcome, dropped: EntrantId[] = []): Result<Bracket, EngineError> {
	const found = findMatch(bracket, matchId, dropped)
	if (!found.ok) return found
	const m = found.value.match
	if (!playable(m)) return err({ code: 'not_playable', message: `Match ${matchId} is ${m.status}` })
	const def = m.def
	const fresh = m.stale || !def.playedBy
	const games = fresh ? [] : def.games
	return ok(
		replaceMatch(bracket, {
			...def,
			playedBy: [m.players[0], m.players[1]],
			games: games.concat([outcome]),
			decision: fresh ? undefined : def.decision,
		}),
	)
}

function validDecision(decision: Decision, stage: Stage): boolean {
	if (decision.kind === 'override' && decision.outcome === 'draw') return drawsCount(stage)
	return true
}

// Matches that already have games or a decision and whose pairing differs
// between two resolutions of the bracket.
function disturbed(before: ResolvedBracket, after: ResolvedBracket): string[] {
	const ids: string[] = []
	for (const m of after.matches) {
		const def = m.def
		if (def.games.length === 0 && !def.decision) continue
		const was = before.byId[def.id]
		if (!was) continue
		if (was.players[0] !== m.players[0] || was.players[1] !== m.players[1]) ids.push(def.id)
	}
	return ids
}

function clearResults(def: MatchDef): MatchDef {
	const { playedBy, decision, ...rest } = def
	return { ...rest, games: [] }
}

// Sets a forfeit, double forfeit or organiser result. When that changes who
// plays a later match that already has results, it is refused with the
// affected match ids -- unless resetDownstream, which clears those results
// (and any further ones they disturb).
export function decideMatch(
	bracket: Bracket,
	matchId: string,
	decision: Decision,
	options: { dropped?: EntrantId[]; resetDownstream?: boolean } = {},
): Result<Bracket, EngineError> {
	const dropped = options.dropped ?? []
	const found = findMatch(bracket, matchId, dropped)
	if (!found.ok) return found
	const m = found.value.match
	if (m.status === 'waiting' || m.status === 'void') return err({ code: 'not_playable', message: `Match ${matchId} is ${m.status}` })
	if (typeof m.players[0] !== 'string' || typeof m.players[1] !== 'string') {
		return err({ code: 'not_playable', message: `Match ${matchId} is a bye` })
	}
	if (!validDecision(decision, m.def.stage)) return err({ code: 'invalid', message: 'Draws only exist in round robin and Swiss' })

	const keepGames = !m.stale && m.def.playedBy !== undefined
	let next = replaceMatch(bracket, {
		...m.def,
		playedBy: [m.players[0], m.players[1]],
		games: keepGames ? m.def.games : [],
		decision,
	})
	const before = found.value.resolved
	for (let guard = 0; guard < next.matches.length + 1; guard++) {
		const after = resolveBracket(next, dropped)
		const hit = disturbed(before, after).filter((id) => id !== matchId)
		if (hit.length === 0) return ok(next)
		if (!options.resetDownstream) {
			return err({ code: 'downstream_played', message: 'Later matches already have results', matchIds: hit })
		}
		for (const id of hit) {
			const def = next.matches.find((x) => x.id === id) as MatchDef
			next = replaceMatch(next, clearResults(def))
		}
	}
	return ok(next)
}

// Removes a decision (and the games, with clearGames) from a match, e.g. to
// undo an organiser override. Same downstream rule as decideMatch.
export function clearMatch(
	bracket: Bracket,
	matchId: string,
	options: { dropped?: EntrantId[]; resetDownstream?: boolean } = {},
): Result<Bracket, EngineError> {
	const dropped = options.dropped ?? []
	const found = findMatch(bracket, matchId, dropped)
	if (!found.ok) return found
	let next = replaceMatch(bracket, clearResults(found.value.match.def))
	const before = found.value.resolved
	for (let guard = 0; guard < next.matches.length + 1; guard++) {
		const hit = disturbed(before, resolveBracket(next, dropped)).filter((id) => id !== matchId)
		if (hit.length === 0) return ok(next)
		if (!options.resetDownstream) return err({ code: 'downstream_played', message: 'Later matches already have results', matchIds: hit })
		for (const id of hit) next = replaceMatch(next, clearResults(next.matches.find((x) => x.id === id) as MatchDef))
	}
	return ok(next)
}

// Sets the series length for a round's matches that have not started yet
// (the organiser may change rounds that haven't been played).
export function setRoundBestOf(bracket: Bracket, stage: Stage, round: number, bestOf: number): Result<Bracket, EngineError> {
	if (BEST_OF_CHOICES.indexOf(bestOf) === -1) return err({ code: 'invalid', message: 'bestOf must be 1, 3, 5 or 7' })
	return ok({
		...bracket,
		matches: bracket.matches.map((m) => (m.stage === stage && m.round === round && m.games.length === 0 && !m.decision ? { ...m, bestOf } : m)),
	})
}

export function swissRoundsPlayed(bracket: Bracket): number {
	return bracket.matches.reduce((max, m) => (m.stage === 'SW' ? Math.max(max, m.round) : max), 0)
}

// Pairs the next Swiss round once every match of the current one is done.
// Dropped players are left out.
export function nextSwissRound(bracket: Bracket, dropped: EntrantId[] = [], bestOf = 1): Result<Bracket, EngineError> {
	if (bracket.format !== 'swiss') return err({ code: 'invalid', message: 'Not a Swiss bracket' })
	const played = swissRoundsPlayed(bracket)
	if (played >= (bracket.options.swissRounds ?? 0)) return err({ code: 'no_more_rounds', message: 'Every Swiss round has been paired' })
	const resolved = resolveBracket(bracket, dropped)
	if (resolved.matches.some((m) => m.def.round === played && m.status !== 'done')) {
		return err({ code: 'round_unfinished', message: `Round ${played} is not finished` })
	}
	const standings = computeStandings(bracket.seeds, resolved.matches, ['seed'], dropped)
	const droppedSet = new Set(dropped)
	const players: SwissPlayer[] = standings
		.filter((row) => !droppedSet.has(row.id))
		.map((row) => {
			const opponents: EntrantId[] = []
			let hadBye = false
			for (const m of resolved.matches) {
				const [a, b] = m.players
				if (a === row.id && b === null) hadBye = true
				if (a === row.id && typeof b === 'string') opponents.push(b)
				if (b === row.id && typeof a === 'string') opponents.push(a)
			}
			return { id: row.id, seed: row.seed, points: row.points, hadBye, opponents }
		})
	if (players.length < 2) return err({ code: 'too_few_entrants', message: 'Fewer than 2 players are left' })
	return ok({ ...bracket, matches: bracket.matches.concat(pairSwissRound(players, played + 1, bestOf)) })
}

// True when no match is still to be played (and, for Swiss, every round is
// paired).
export function isFinished(bracket: Bracket, dropped: EntrantId[] = []): boolean {
	if (bracket.format === 'swiss' && swissRoundsPlayed(bracket) < (bracket.options.swissRounds ?? 0)) return false
	return resolveBracket(bracket, dropped).matches.every((m) => m.status === 'done' || m.status === 'void')
}

export interface Placement {
	id: EntrantId
	// Shared by everyone eliminated at the same point (e.g. 5th for 5th-8th).
	place: number
}

// Final placings. Elimination: the champion, then everyone else by how late
// they were knocked out (players knocked out in the same round share a
// place). Round robin/Swiss: the standings (round robin groups are ranked
// side by side: every group winner, then every runner-up, ...).
export function finalPlacements(bracket: Bracket, dropped: EntrantId[] = []): Placement[] {
	const resolved = resolveBracket(bracket, dropped)
	if (bracket.format === 'round_robin' || bracket.format === 'swiss') {
		const tiebreakers = tiebreakersFor(bracket)
		if (bracket.format === 'swiss') {
			return computeStandings(bracket.seeds, resolved.matches, tiebreakers, dropped).map((r) => ({ id: r.id, place: r.rank }))
		}
		const groups = splitGroups(bracket.seeds, bracket.options.groupSize ?? bracket.seeds.length)
		const tables = groups.map((members, g) =>
			computeStandings(
				members,
				resolved.matches.filter((m) => m.def.group === g + 1),
				tiebreakers,
				dropped,
			),
		)
		const out: Placement[] = []
		const longest = Math.max(...tables.map((t) => t.length))
		for (let rank = 0; rank < longest; rank++) {
			const place = out.length + 1
			for (const table of tables) if (table[rank]) out.push({ id: table[rank].id, place })
		}
		return out
	}

	// Elimination: a player is out once their losses reach their lives (2 in
	// double elimination), or -- once the bracket is finished -- at their last
	// loss (the unbeaten player who loses a grand final with no reset). Later
	// eliminations place higher; one round's eliminations share a place.
	// Placings are partial while the bracket runs: only those already out.
	const lives = bracket.format === 'double_elim' ? 2 : 1
	const losses: { [id: string]: number } = {}
	const lastLoss: { [id: string]: number } = {}
	const out: { [id: string]: number } = {}
	let champion: EntrantId | null = null
	for (let index = 0; index < resolved.matches.length; index++) {
		const m = resolved.matches[index]
		if (m.status !== 'done' || !m.outcome || m.outcome.draw) continue
		const [a, b] = m.players
		const losers: EntrantId[] = []
		if (m.outcome.loser) losers.push(m.outcome.loser)
		// A double forfeit / override to nobody: both players lose.
		else if (m.outcome.winner === null && typeof a === 'string' && typeof b === 'string') losers.push(a, b)
		for (const id of losers) {
			losses[id] = (losses[id] ?? 0) + 1
			lastLoss[id] = index
			if (losses[id] >= lives) out[id] = index
		}
		if (m.outcome.winner) champion = m.outcome.winner
	}
	const finished = isFinished(bracket, dropped)
	if (finished) {
		for (const id of bracket.seeds) if (id !== champion && out[id] === undefined && lastLoss[id] !== undefined) out[id] = lastLoss[id]
	}
	const alive = bracket.seeds.filter((id) => out[id] === undefined)
	const ranked = bracket.seeds.filter((id) => out[id] !== undefined).sort((x, y) => out[y] - out[x] || bracket.seeds.indexOf(x) - bracket.seeds.indexOf(y))
	const roundKey = (id: EntrantId) => {
		const def = resolved.matches[out[id]].def
		return `${def.stage}${def.round}`
	}
	const result: Placement[] = []
	if (finished && champion !== null) result.push({ id: champion, place: 1 })
	// Everyone still alive ranks above everyone already out.
	const ahead = finished ? result.length : alive.length
	ranked.forEach((id, i) => {
		const prev = ranked[i - 1]
		const place = prev !== undefined && roundKey(prev) === roundKey(id) ? result[result.length - 1].place : ahead + i + 1
		result.push({ id, place })
	})
	return result
}
