import { withTeamResult } from '../result'
// The Manhunt rule set: one Runner against the Hunters (docs/pvp-match.md section 6),
// the rules R35-R45 of the appendix. The roster and the round
// opening are the shared ones (modes/common.ts); this file settles who the Runner is, how a round is won
// (the Runner against every Hunter), who gains a life from the Runner's voucher,
// and when the game ends. Every hook is pure: (state, ctx) -> state, and returns
// the same object when it changes nothing. A mode only names people: the tick
// takes and gives every life.
import { SCORE_ZERO, compareRoundScore, greater } from '../score'
import type { ModeView, PvpTeam } from '../state'
import {
	allOutOfHands,
	inRunWithLives,
	roundReady,
	scoreOf,
	seatPlayers,
} from './common'
import type {
	Hook,
	InitHook,
	Mode,
	RunStart,
	ViewHook,
	VoucherGainers,
	VoucherRedeemer,
} from './types'

export const RUNNER_LIVES = 1

// R41: the Runner wins on reaching ante 9, one past this.
export const LAST_ANTE = 8

function idsOf(state: ModeView, team: PvpTeam): string[] {
	return Object.keys(state.teams.teams)
		.filter((id) => state.teams.teams[id] === team)
		.sort()
}

// The roster is `state.teams`, settled by `init`: null before that.
const runnerOf = (state: ModeView): string | null =>
	idsOf(state, 'RUNNER')[0] ?? null

const isAliveId = (state: ModeView, id: string): boolean => {
	const seat = state.lives.players[id]
	return seat !== undefined && inRunWithLives(seat)
}

const aliveHunters = (state: ModeView): string[] =>
	idsOf(state, 'HUNTER').filter((id) => isAliveId(state, id))

// R35: the Runner is the first starter who picked RUNNER,
// else the first starter. Start order, not the order the picks arrived in.
function runnerAt(start: RunStart): string | undefined {
	return (
		start.startedIds.find((id) => start.picks[id] === 'RUNNER') ??
		start.startedIds[0]
	)
}

// R35, R36: everyone else is a Hunter, whatever they picked; the team plan is for
// Teams. The Runner has 1 life, a Hunter `hunterLives`. The rest (round entries,
// votes) is `seatPlayers`, which also leaves a run already settled alone.
const init: InitHook = (state, ctx, start) => {
	const seated = seatPlayers(state, ctx)
	const { rules } = seated
	if (seated === state || rules.runId === null) return state
	const runner = runnerAt(start)
	const teams: { [id: string]: PvpTeam } = {}
	const players = { ...seated.lives.players }
	for (const id of start.startedIds) {
		const seat = players[id]
		teams[id] = id === runner ? 'RUNNER' : 'HUNTER'
		if (seat)
			players[id] = {
				...seat,
				lives: id === runner ? RUNNER_LIVES : rules.hunterLives,
			}
	}
	return {
		...seated,
		teams: { runId: rules.runId, teams },
		lives: { ...seated.lives, players },
	}
}

// R38: a Hunter loses to a lower score, or to a tie with a
// Runner who scored; 0-0 costs nothing. An unreported score ranks below every
// reported one (compareRoundScore), so it never ties a scored Runner.
const behindRunner = (
	hunter: string | null,
	runner: string | null,
): boolean => {
	const order = compareRoundScore(runner, hunter)
	return (
		order === 1 ||
		(order === 0 && runner !== null && greater(runner, SCORE_ZERO))
	)
}

// R38, R39: the Hunters behind the Runner lose; the Runner loses
// only to a Hunter strictly ahead of it, so a tie never catches it.
function losersOf(state: ModeView, runner: string): string[] {
	const hunters = aliveHunters(state)
	const runnerScore = scoreOf(state, runner)
	const behind = hunters.filter((id) =>
		behindRunner(scoreOf(state, id), runnerScore),
	)
	const caught = hunters.some(
		(id) => compareRoundScore(scoreOf(state, id), runnerScore) === 1,
	)
	return caught ? [runner, ...behind] : behind
}

// R37: the round resolves once, when EVERY alive player has
// no hands left; a dead, forfeited or left player is never waited for. With no
// Runner or no Hunter alive there is no round to rank: the game is ending.
const resolveRound: Hook = (state) => {
	if (state.result.kind !== null || state.round.phase !== 'playing')
		return state
	const runner = runnerOf(state)
	if (runner === null || !isAliveId(state, runner)) return state
	const hunters = aliveHunters(state)
	if (hunters.length === 0) return state
	if (!allOutOfHands(state, [runner, ...hunters])) return state
	return {
		...state,
		round: {
			...state.round,
			phase: 'resolved',
			lastResult: {
				roundId: state.round.roundId,
				losers: losersOf(state, runner),
			},
		},
	}
}

// R42: the Runner's ante-skip voucher gives every Hunter a
// life; anyone else's gives nobody. The tick skips a seat at 0 lives or out of the
// run (the host's life for a Hunter at 0 was a bug, not a rule). The dedupe is
// facts.ts: one gain per voucher, two vouchers two gains.
const voucherGainers: VoucherGainers = (state, fact) =>
	state.teams.teams[fact.playerId] === 'RUNNER' ? idsOf(state, 'HUNTER') : []

// R42: only the Runner redeems the ante-skip voucher (anyone else is refused
// `not_runner`).
const mayRedeemVoucher: VoucherRedeemer = (state, playerId) =>
	state.teams.teams[playerId] === 'RUNNER'

// R45: of the two sides only a dying Runner opens a pending death; a Hunter at 0
// is simply out.
const opensSideDeath = (state: ModeView, playerId: string): boolean =>
	state.teams.teams[playerId] === 'RUNNER'

// R40, R41, R43, in the old host's order, so
// every Manhunt ending is decided here and onForfeit does nothing. A decided
// result is never overwritten (withTeamResult), and before `init` there is no
// Runner:
// 1. the Runner is out of the run or at 0 lives: the Hunters win;
// 2. no Hunter is in the run with lives left: the Runner wins;
// 3. R41: the Runner's own ante is past LAST_ANTE and no round is playing (a win
//    mid-round waits for the round to end).
// The tick holds this back while a pending death is open (R45).
const checkWinner: Hook = (state) => {
	const runner = runnerOf(state)
	if (runner === null) return state
	if (!isAliveId(state, runner)) return withTeamResult(state, 'win', 'HUNTER')
	if (aliveHunters(state).length === 0)
		return withTeamResult(state, 'win', 'RUNNER')
	// A Runner who has reported no ante never wins here.
	const entry = state.round.players[runner]
	const ante = entry === undefined ? null : entry.ante
	if (ante !== null && ante > LAST_ANTE && state.round.phase !== 'playing')
		return withTeamResult(state, 'win', 'RUNNER')
	return state
}

// R43: a seat that forfeited or left is already out of the run, and checkWinner
// reads that. A Runner who forfeits while a team pending is open is not decided
// here either: the pending is (deaths.ts).
const onForfeit: Hook = (state) => state

// R44: every Hunter targets the Runner; the Runner targets
// the Hunter in the run with the highest round score. Ties go to the smaller id
// (a decision of this wave: the host's "first in order" has no order here).
const view: ViewHook = (state) => {
	const runner = runnerOf(state)
	if (runner === null) return { opponents: {} }
	const opponents: { [id: string]: string | null } = {}
	for (const id of idsOf(state, 'HUNTER')) opponents[id] = runner
	opponents[runner] = aliveHunters(state).reduce<string | null>(
		(best, id) =>
			best === null ||
			compareRoundScore(scoreOf(state, id), scoreOf(state, best)) > 0
				? id
				: best,
		null,
	)
	return { opponents }
}

export const manhuntMode: Mode = {
	name: 'manhunt',
	// R45: the Runner's death waits on the Hunters as a whole.
	deathPolicy: 'side',
	opensSideDeath,
	// R34: a lost blind puts the player out of hands, so the round does not wait on them.
	outOfHandsOnFail: true,
	init,
	roundReady,
	resolveRound,
	voucherGainers,
	mayRedeemVoucher,
	checkWinner,
	onForfeit,
	view,
}
