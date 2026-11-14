// The Teams rule set: A against B, one shared pool of lives per team (docs/pvp-match.md
// section 6), the rules R46-R54 of the appendix. Every hook is
// pure: (state, ctx) -> state, and returns the same object when it changes nothing.
//
// It shares the seats, round opening and start (modes/common.ts); this file
// adds the team split, the life pool (`lifePool`: who pays, and the pool's
// drop), the round decided by team score, the win check on pools and rosters,
// and the card targets. Every life change is the tick's: it asks `lifePool` and
// the pool drops once per losing team (lives.ts), and a pool at 0 on a normal
// blind opens the team pending death (deaths.ts); resolveRound only names the
// losing team's members in `round.lastResult`.
import type { StepContext } from '../../../actions/registry'
import { withTeamResult } from '../result'
import { compareRoundScore, sum } from '../score'
import {
	type ModeView,
	type PvpCardTargets,
	type PvpTeam,
	inRunIgnoringLives,
} from '../state'
import {
	aliveIds,
	allOutOfHands,
	highestAnte,
	roundReady,
	scoreOf,
	seatPlayers,
} from './common'
import type {
	Hook,
	InitHook,
	LifePool,
	Mode,
	RunStart,
	ViewHook,
} from './types'

type Side = 'A' | 'B'

const SIDES: Side[] = ['A', 'B']

const otherSide = (side: Side): Side => (side === 'A' ? 'B' : 'A')

const asSide = (team: PvpTeam | undefined): Side | null =>
	team === 'A' || team === 'B' ? team : null

// R46 (1): the server's team plan, `plan[0]` is team A and `plan[1]` team B. Ids
// that did not start are ignored; an id named twice stays with the later team.
function plannedTeams(start: RunStart): { [id: string]: Side } {
	const started = new Set(start.startedIds)
	const planned: { [id: string]: Side } = {}
	SIDES.forEach((side, i) => {
		for (const id of start.teamPlan?.[i] ?? [])
			if (started.has(id)) planned[id] = side
	})
	return planned
}

// R46: the plan overrides a pick, a pick of A or B is
// kept as picked (everyone on A is possible), and each player with neither goes
// to the team that has fewer members at that moment, a tie to A. The unplanned
// and unpicked are walked in start order, so the order the picks were made in
// (the keys of `start.picks`) never matters.
export function assignTeams(start: RunStart): { [id: string]: Side } {
	const planned = plannedTeams(start)
	const teams: { [id: string]: Side } = {}
	for (const id of start.startedIds) {
		const side = planned[id] ?? asSide(start.picks[id])
		if (side !== null) teams[id] = side
	}
	const size = { A: 0, B: 0 }
	for (const side of Object.values(teams)) size[side]++
	for (const id of start.startedIds) {
		if (teams[id] !== undefined) continue
		const side: Side = size.B < size.A ? 'B' : 'A'
		teams[id] = side
		size[side]++
	}
	return teams
}

const membersOf = (state: ModeView, side: Side, ids: string[]): string[] =>
	ids.filter((id) => state.teams.teams[id] === side)

// One random alive member of the other team (`alive` is sorted, so the candidates
// are too), null when that team has nobody alive.
function drawTarget(
	state: ModeView,
	mine: Side,
	alive: string[],
	random: () => number,
): string | null {
	const candidates = membersOf(state, otherSide(mine), alive)
	return candidates.length === 0
		? null
		: candidates[Math.floor(random() * candidates.length)]
}

// R51 (the card targets): every alive player targets one random
// alive member of the other team, null when that team has nobody alive. Players
// are walked in sorted order and the candidates are sorted, so one random
// sequence always gives the same targets; a player who is not alive has no entry.
export function drawCardTargets(
	state: ModeView,
	ante: number,
	random: () => number,
): PvpCardTargets {
	const alive = aliveIds(state)
	const targets: { [id: string]: string | null } = {}
	for (const id of alive) {
		const mine = asSide(state.teams.teams[id])
		if (mine === null) continue
		targets[id] = drawTarget(state, mine, alive, random)
	}
	return { ante, targets }
}

// R51, after a forfeit or a left seat: the stored targets of this ante are kept
// except where they point at, or belong to, a player who is no longer alive. An
// entry whose holder is gone is dropped; one whose target is gone is drawn again
// from the alive members of the other team (null when there are none). Same ante,
// holders walked in sorted order, `random` only. Null when there is nothing to
// change (no targets stored, or none stale): the runtime hands back a new wrapper
// on every read, so "unchanged" is a value, never an identity.
export function repairCardTargets(
	state: ModeView,
	random: () => number,
): PvpCardTargets | null {
	const held = state.cardTargets
	if (held === null) return null
	const alive = aliveIds(state)
	const isAliveId = (id: string): boolean => alive.includes(id)
	const holders = Object.keys(held.targets).sort()
	const stale = holders.some((id) => {
		const target = held.targets[id]
		return !isAliveId(id) || (target !== null && !isAliveId(target))
	})
	if (!stale) return null
	const targets: { [id: string]: string | null } = {}
	for (const id of holders) {
		const mine = asSide(state.teams.teams[id])
		if (!isAliveId(id) || mine === null) continue
		const target = held.targets[id]
		targets[id] =
			target !== null && !isAliveId(target)
				? drawTarget(state, mine, alive, random)
				: target
	}
	return { ante: held.ante, targets }
}

// R46, R47: the shared seats and hands first (once per run id, the "already
// frozen" test of `seatPlayers`), then each started id on a team, a pool of the
// starting lives per team (every member already holds the same number: they
// were seated with `startingLives`), and the first card targets.
const init: InitHook = (state, ctx, start) => {
	const { rules } = state
	if (rules.runId === null || state.round.runId === rules.runId) return state
	const seated = seatPlayers(state, ctx)
	const pool = { A: rules.startingLives, B: rules.startingLives }
	const settled: ModeView = {
		...seated,
		teams: { runId: rules.runId, teams: assignTeams(start) },
		lives: { ...seated.lives, teamLives: pool },
	}
	return {
		...settled,
		cardTargets: drawCardTargets(settled, 1, ctx.random),
	}
}

// The round score of a team: the sum of its alive members' scores this round
// (R48, R54). A member who has reported no score adds nothing; a team with no
// member reporting has no score (null), which ranks below every real score.
function teamScore(
	state: ModeView,
	side: Side,
	alive: string[],
): string | null {
	const reported: string[] = []
	for (const id of membersOf(state, side, alive)) {
		const score = scoreOf(state, id)
		if (score !== null) reported.push(score)
	}
	return reported.length === 0 ? null : sum(reported)
}

// R48 (the team round): the round resolves once, when every alive
// player has no hands left. The higher team sum wins, equal sums cost nobody, and
// the losers are the losing team's alive members (the tick takes the pool's life
// once per team and round).
const resolveRound: Hook = (state) => {
	if (state.result.runId !== null || state.round.phase !== 'playing')
		return state
	const alive = aliveIds(state)
	if (alive.length === 0) return state
	if (!allOutOfHands(state, alive)) return state
	const a = teamScore(state, 'A', alive)
	const b = teamScore(state, 'B', alive)
	const order = compareRoundScore(a, b)
	const loser: Side | null = order === 0 ? null : order < 0 ? 'A' : 'B'
	return {
		...state,
		round: {
			...state.round,
			phase: 'resolved',
			lastResult: {
				roundId: state.round.roundId,
				losers: loser === null ? [] : membersOf(state, loser, alive),
			},
		},
	}
}

// A team is out when its pool is empty or no member of it is still in the run.
function teamIsOut(state: ModeView, side: Side, pool: number): boolean {
	const members = Object.keys(state.lives.players).filter(
		(id) => state.teams.teams[id] === side,
	)
	return (
		pool <= 0 ||
		!members.some((id) => inRunIgnoringLives(state.lives.players[id]))
	)
}

// R50, R52: a team that is out loses, and the other team wins; both out is a
// draw. A game that starts with every player on one team ends at once for that
// team (rule 52 as written, with no balancing rule). The tick holds this back
// while a pending death is open (R53), so a pool that emptied on a normal blind
// waits for the other team's result first.
const checkWinner: Hook = (state) => {
	const { rules } = state
	if (rules.runId === null || state.lives.runId !== rules.runId) return state
	if (state.result.runId !== null || state.lives.pending.length > 0)
		return state
	if (state.lives.teamLives === null) return state
	const { teamLives } = state.lives
	const aOut = teamIsOut(state, 'A', teamLives.A)
	const bOut = teamIsOut(state, 'B', teamLives.B)
	if (aOut && bOut) return withTeamResult(state, 'draw', null)
	if (aOut) return withTeamResult(state, 'win', 'B')
	if (bOut) return withTeamResult(state, 'win', 'A')
	return state
}

// R52: a forfeit or a left seat counts for the win check, which the tick runs
// after every step. The tick calls this hook only in a step where somebody newly
// forfeited or left, so it repairs the stored card targets (R51) to match.
const onForfeit: Hook = (state, ctx) => {
	const targets = repairCardTargets(state, ctx.random)
	return targets === null ? state : { ...state, cardTargets: targets }
}

// R51: new card targets once per new highest ante (the first tick's ante 1 was
// drawn by `init`); a second call at the same ante changes nothing.
const onAnte: Hook = (state, ctx: StepContext) => {
	const ante = highestAnte(state)
	// No ante reported yet: nothing to draw for.
	if (ante === null) return state
	if (state.cardTargets !== null && ante <= state.cardTargets.ante) return state
	return { ...state, cardTargets: drawCardTargets(state, ante, ctx.random) }
}

// R54 (the live display): the two team sums for the HUD, and the
// stored card targets. There is no per-player opponent in Teams.
const view: ViewHook = (state) => {
	const alive = aliveIds(state)
	return {
		opponents: {},
		cardTargets: state.cardTargets?.targets ?? {},
		teamScores: {
			A: teamScore(state, 'A', alive),
			B: teamScore(state, 'B', alive),
		},
	}
}

// The team's pool and the side it belongs to; null for a seat on no team A/B or
// before `init` made the pools.
function poolOf(
	state: ModeView,
	id: string,
): { side: Side; pool: { A: number; B: number } } | null {
	const side = asSide(state.teams.teams[id])
	const pool = state.lives.teamLives
	return side === null || pool === null ? null : { side, pool }
}

// R47, R48, R49: every player's failure costs the team's pool one life, so two
// teammates failing one blind cost two. The tick (lives.ts) asks this pool who
// pays and has it spend, and keeps the guards and the pending death itself.
// A seat with no team A/B is not charged: that every started id has a team is
// this mode's `init` property.
const lifePool: LifePool = {
	// The whole team of `id`, or nobody when it has no pool or the pool is already at 0.
	sharers: (state, id) => {
		const held = poolOf(state, id)
		if (!held || !state.lives.players[id] || held.pool[held.side] <= 0)
			return []
		return membersOf(state, held.side, Object.keys(state.lives.players))
	},
	// One life off the pool of `id`'s team, shown on every seat of that team
	// with the same event and the pool's value.
	spend: (state, id, key) => {
		const held = poolOf(state, id)
		if (!held) return state
		const lives = held.pool[held.side] - 1
		const players = { ...state.lives.players }
		for (const member of membersOf(state, held.side, Object.keys(players)))
			players[member] = {
				...players[member],
				lives,
				eliminated: lives <= 0,
				events: [...players[member].events, { delta: -1, key }],
			}
		return {
			...state,
			lives: {
				...state.lives,
				players,
				teamLives: { ...held.pool, [held.side]: lives },
			},
		}
	},
	// One loser per losing team (the smallest id, so the order of the losers cannot
	// matter): the team loses one life, not one per member.
	payers: (state, losers) => {
		const byTeam: { [team: string]: string } = {}
		for (const id of losers) {
			const team = state.teams.teams[id]
			if (
				team !== undefined &&
				(byTeam[team] === undefined || id < byTeam[team])
			)
				byTeam[team] = id
		}
		return Object.values(byTeam).sort()
	},
}

export const teamsMode: Mode = {
	name: 'teams',
	// R53: the pool of a team at 0 opens a pending death that waits on the other team.
	deathPolicy: 'side',
	lifePool,
	// R34: a lost blind puts the player out of hands, so the round does not wait on them.
	outOfHandsOnFail: true,
	init,
	roundReady,
	resolveRound,
	checkWinner,
	onAnte,
	onForfeit,
	view,
}
