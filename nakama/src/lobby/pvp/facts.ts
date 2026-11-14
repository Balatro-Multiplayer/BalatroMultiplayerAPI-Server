// The fact reducers for the PvP requests (docs/pvp-match.md section 3). Pure, like
// state.ts: (state, playerId, args) -> the new state or a refusal code. The timer
// requests' reducers are in timer_facts.ts, what they all share is in reducer.ts.
//
// A reducer RECORDS the client's fact and decides nothing: lives, round
// resolution, pending deaths, votes' outcome and the winner are the tick's
// (tick.ts). Facts that no match key shows (a blind result, an ante-timer
// run-out, a voucher, a forfeit) go to `facts`, an append-only log the tick
// reads from its `applied` cursor. Every reducer is idempotent: the same
// request again (same blind, same hand) changes nothing.
import { modeOfGame } from './modes'
import { isCount, isName, isRecord } from './payload'
import {
	type FactReducer,
	type FactResult,
	PVP_ROUND_KEY,
	PVP_VOTES_KEY,
	entryOf,
	gate,
	handsAfter,
	isOut,
	refuse,
	runIdOf,
	unchanged,
	withPlayer,
} from './reducer'
import { compare, parse } from './score'
import { isBlindKey } from './settings'
import {
	type PvpRoundPlayer,
	type PvpVotes,
	type RefereeState,
	mergeBlind,
	withFact,
} from './state'
import { reduceSkip } from './skip_facts'

export const MAX_HANDS = 100
const MAX_VOUCHER_KEY_CHARS = 64

// The credit rule, one for a commit and a hand: a hand count `count` earns the hands
// the watermark is above it, and the watermark comes down to it. A watermark is set
// at the player's blind_start, so null (none yet) earns nothing and stays null.
// A ruleset with a PvP clock earns hand time; one without has nothing to credit.
function earnsHandTime(state: RefereeState): boolean {
	const rules = state.rules
	return rules.runId !== null && rules.clocks.pvp !== null
}

// Every real hand is credited once: a repeat of a count earns 0.
function creditFor(
	creditedHands: number | null,
	count: number,
): { hands: number; creditedHands: number | null } {
	if (creditedHands === null) return { hands: 0, creditedHands: null }
	return {
		hands: Math.max(0, creditedHands - count),
		creditedHands: Math.min(creditedHands, count),
	}
}

// The `timerLossesApplied` of a request: a count, never above the run-outs the
// server has accepted from the sender.
function appliedOf(
	args: { [key: string]: unknown },
	prior: PvpRoundPlayer,
): number | null {
	const applied = args.timerLossesApplied
	if (!isCount(applied) || applied > prior.timerLosses) return null
	return applied
}

// pvp.blind_start {runId, roundId, handsLeft, score, timerLossesApplied}: the hands
// and the score the sender's PvP blind starts with, sent once its setting_blind
// effects ran. The FIRST one of a round is kept; a resend (a rejoin, a retry)
// changes nothing and answers ok. It plays no hand: it does not stamp handRound,
// so the score mask waits for the first real hand.
export function reduceBlindStart(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (
		runId === null ||
		!isRecord(args) ||
		!isCount(args.roundId) ||
		!isCount(args.handsLeft, MAX_HANDS) ||
		!isCount(args.timerLossesApplied) ||
		typeof args.score !== 'string'
	)
		return refuse('bad_payload')
	const score = parse(args.score)
	if (score === null) return refuse('bad_score')
	const refused = gate(state, id, runId)
	if (refused) return refused
	if (args.roundId !== state.round.roundId) return refuse('round_over')
	if (state.round.phase !== 'playing') return refuse('not_playing')
	const prior = entryOf(state, id)
	if ('ok' in prior) return prior
	// A resend is an ok no-op whatever it claims.
	if (
		state.facts.handRound[id] === args.roundId ||
		prior.reportedHands !== null
	)
		return unchanged(state)
	const applied = appliedOf(args, prior)
	if (applied === null) return refuse('bad_payload')
	const handsLeft = handsAfter(args.handsLeft, applied, prior.timerLosses)
	const entry: PvpRoundPlayer = {
		...prior,
		score,
		reportedHands: args.handsLeft,
		reportedApplied: applied,
		handsLeft,
		// Hand time is credited for the hands from here on, never for these; a
		// ruleset with no PvP clock earns none, so the watermark stays null.
		creditedHands: earnsHandTime(state) ? handsLeft : null,
	}
	return {
		ok: true,
		state: withPlayer(state, id, entry),
		changed: [PVP_ROUND_KEY],
	}
}

// pvp.hand_commit {runId, roundId, handsLeft, timerLossesApplied}: sent when Play is
// pressed in the PvP blind, before the hand scores, so the server can credit its time
// ahead of the animation. `handsLeft` is the count after the hand, derived like
// pvp.hand's (so a press made while a run-out is on its way to the client is not
// refused). Accepted only while the round plays, with a known count, for exactly the
// next hand, with no commit pending, and when it earns time (the watermark is above
// it); anything else is `stale_commit` and the hand plays with no credit. It binds
// the next pvp.hand to this count (reduceHand).
export function reduceHandCommit(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (
		runId === null ||
		!isRecord(args) ||
		!isCount(args.roundId) ||
		!isCount(args.handsLeft, MAX_HANDS) ||
		!isCount(args.timerLossesApplied)
	)
		return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const rules = state.rules
	if (rules.runId !== state.runId) return refuse('not_running')
	if (rules.clocks.pvp === null) return refuse('no_timer')
	if (args.roundId !== state.round.roundId) return refuse('round_over')
	if (state.round.phase !== 'playing') return refuse('not_playing')
	const prior = entryOf(state, id)
	if ('ok' in prior) return prior
	const applied = appliedOf(args, prior)
	if (applied === null) return refuse('bad_payload')
	if (prior.handsSpent) return refuse('hands_spent')
	const count = handsAfter(args.handsLeft, applied, prior.timerLosses)
	const credit = creditFor(prior.creditedHands, count)
	if (
		prior.handsLeft === null ||
		count !== prior.handsLeft - 1 ||
		prior.committedHands !== null ||
		credit.hands <= 0
	)
		return refuse('stale_commit')
	const entry: PvpRoundPlayer = {
		...prior,
		committedHands: count,
		creditedHands: credit.creditedHands,
	}
	return {
		ok: true,
		state: withFact(withPlayer(state, id, entry), {
			type: 'hand_credit',
			playerId: id,
			hands: credit.hands,
		}),
		changed: [],
	}
}

// pvp.hand {runId, roundId, score, handsLeft, timerLossesApplied}: within a round
// the count only goes down and the score only goes up; anything else is
// `stale_hand`. After the server ended the sender's hands it is `hands_spent`. A
// pending commit binds it: the derived count is the committed one, or lower (a hand
// whose pvp.hand was lost on the wire: scores are cumulative, so the later hand covers
// it), and the hand clears the commit. A count above the committed one is
// `commit_mismatch`. The hand also runs the credit rule, so a hand with no commit (or
// after a refused one) is credited once too, and never twice (the watermark only drops).
export function reduceHand(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (
		runId === null ||
		!isRecord(args) ||
		!isCount(args.roundId) ||
		typeof args.score !== 'string' ||
		!isCount(args.handsLeft, MAX_HANDS)
	)
		return refuse('bad_payload')
	const score = parse(args.score)
	if (score === null) return refuse('bad_score')
	const refused = gate(state, id, runId)
	if (refused) return refused
	if (args.roundId !== state.round.roundId) return refuse('round_over')
	if (state.round.phase !== 'playing') return refuse('not_playing')
	const prior = entryOf(state, id)
	if ('ok' in prior) return prior
	const applied = appliedOf(args, prior)
	if (applied === null) return refuse('bad_payload')
	if (prior.handsSpent) return refuse('hands_spent')
	// The applied count only goes up within a round.
	if (applied < prior.reportedApplied) return refuse('stale_hand')
	if (prior.reportedHands !== null && args.handsLeft > prior.reportedHands)
		return refuse('stale_hand')
	if (prior.score !== null && compare(score, prior.score) === -1)
		return refuse('stale_hand')
	// A higher score needs a hand spent (fewer hands left) or a timer loss newly applied.
	if (
		prior.score !== null &&
		prior.reportedHands !== null &&
		compare(score, prior.score) === 1 &&
		args.handsLeft >= prior.reportedHands &&
		applied <= prior.reportedApplied
	)
		return refuse('stale_hand')
	const highest =
		prior.highestScore === null || compare(score, prior.highestScore) === 1
			? score
			: prior.highestScore
	const handsLeft = handsAfter(args.handsLeft, applied, prior.timerLosses)
	const entry: PvpRoundPlayer = {
		...prior,
		score,
		reportedHands: args.handsLeft,
		reportedApplied: applied,
		handsLeft,
		highestScore: highest,
	}
	if (
		state.facts.handRound[id] === args.roundId &&
		prior.score === entry.score &&
		prior.reportedHands === entry.reportedHands &&
		prior.reportedApplied === entry.reportedApplied &&
		prior.highestScore === entry.highestScore
	)
		return unchanged(state)
	// A refusal carries no state, so a mismatched hand leaves the commit pending. A hand
	// BELOW the committed count is the next hand after a lost one: it clears the commit
	// below and is credited once (creditFor reads the watermark, which the commit moved).
	if (prior.committedHands !== null && handsLeft > prior.committedHands)
		return refuse('commit_mismatch')
	const credit = creditFor(prior.creditedHands, handsLeft)
	const next = withPlayer(
		state,
		id,
		{ ...entry, committedHands: null, creditedHands: credit.creditedHands },
		args.roundId,
	)
	return {
		ok: true,
		state:
			credit.hands > 0
				? withFact(next, {
						type: 'hand_credit',
						playerId: id,
						hands: credit.hands,
					})
				: next,
		changed: [PVP_ROUND_KEY],
	}
}

// pvp.blind {runId, blindKey, beaten, roundLost}: a blind result. Failure is
// final (R12). `beaten:false` alone only records it; `roundLost:true` (the
// fail_round send site) is the separate fact that costs the guarded life.
export function reduceBlind(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (
		runId === null ||
		!isRecord(args) ||
		!isBlindKey(args.blindKey) ||
		typeof args.beaten !== 'boolean' ||
		typeof args.roundLost !== 'boolean' ||
		(args.beaten && args.roundLost)
	)
		return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const merged = mergeBlind(state, id, args.blindKey, {
		beaten: args.beaten,
		roundLost: args.roundLost,
	})
	if (!merged.changed) return unchanged(state)
	return {
		ok: true,
		state: withFact(merged.state, {
			type: 'blind',
			playerId: id,
			blindKey: args.blindKey,
			beaten: merged.record.beaten,
			roundLost: merged.record.roundLost,
		}),
		changed: [],
	}
}

// The larger of a reported value and the prior report; the report itself when
// there is no prior (null is not zero).
function higher(prior: number | null, reported: number): number {
	return prior === null ? reported : Math.max(prior, reported)
}

// pvp.progress {runId, ante, furthestBlind}: both only go up.
export function reduceProgress(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (
		runId === null ||
		!isRecord(args) ||
		!isCount(args.ante) ||
		!isCount(args.furthestBlind)
	)
		return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const prior = entryOf(state, id)
	if ('ok' in prior) return prior
	const ante = higher(prior.ante, args.ante)
	const furthestBlind = higher(prior.furthestBlind, args.furthestBlind)
	if (prior.ante === ante && prior.furthestBlind === furthestBlind)
		return unchanged(state)
	return {
		ok: true,
		state: withFact(withPlayer(state, id, { ...prior, ante, furthestBlind }), {
			type: 'progress',
			playerId: id,
		}),
		changed: [PVP_ROUND_KEY],
	}
}

// pvp.voucher {runId, voucherKey}: a Runner ante-skip voucher, once per
// (runId, voucherKey) (R42). The life it gives is the tick's.
export function reduceVoucher(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	const voucherKey = isRecord(args) ? args.voucherKey : undefined
	if (runId === null || !isName(voucherKey, MAX_VOUCHER_KEY_CHARS))
		return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	if (!modeOfGame(state)?.mayRedeemVoucher?.(state, id))
		return refuse('not_runner')
	if (
		state.facts.log.some(
			(f) =>
				f.type === 'voucher' &&
				f.playerId === id &&
				f.voucherKey === voucherKey,
		)
	)
		return refuse('already_redeemed')
	return {
		ok: true,
		state: withFact(state, { type: 'voucher', playerId: id, voucherKey }),
		changed: [],
	}
}

// pvp.forfeit {runId}: the sender has forfeited (the tick decides what follows).
export function reduceForfeit(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (runId === null) return refuse('bad_payload')
	const refused = gate(state, id, runId, true)
	if (refused) return refused
	if (isOut(state, id)) {
		// A repeat forfeit changes nothing; any other way out is `eliminated`.
		const forfeitedAlready =
			state.lives.players[id]?.forfeited === true ||
			state.facts.log.some((f) => f.type === 'forfeit' && f.playerId === id)
		return forfeitedAlready ? unchanged(state) : refuse('eliminated')
	}
	return {
		ok: true,
		state: withFact(state, { type: 'forfeit', playerId: id }),
		changed: [],
	}
}

function withVote(
	votes: PvpVotes,
	kind: 'draw' | 'seed',
	ids: string[],
): PvpVotes {
	return { ...votes, [kind]: ids }
}

// pvp.vote {runId, kind, yes}: the sender's vote. No vote is open before the
// tick has frozen pvp.rules for this run (`no_vote`).
export function reduceVote(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (
		runId === null ||
		!isRecord(args) ||
		(args.kind !== 'draw' && args.kind !== 'seed') ||
		typeof args.yes !== 'boolean'
	)
		return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	if (state.rules.runId !== state.runId) return refuse('no_vote')
	const kind = args.kind
	const current = state.votes.runId === state.runId ? state.votes[kind] : []
	const has = current.includes(id)
	if (args.yes === has) return unchanged(state)
	const ids = args.yes ? [...current, id] : current.filter((v) => v !== id)
	const base: PvpVotes =
		state.votes.runId === state.runId
			? state.votes
			: { runId: state.runId, draw: [], seed: [] }
	return {
		ok: true,
		state: { ...state, votes: withVote(base, kind, ids) },
		changed: [PVP_VOTES_KEY],
	}
}

// Request type -> fact reducer, for register.ts (the timer start and pause need
// the timer world, so register.ts lists them itself).
export const FACT_REDUCERS: { [type: string]: FactReducer } = {
	'pvp.blind_start': reduceBlindStart,
	'pvp.hand': reduceHand,
	'pvp.hand_commit': reduceHandCommit,
	'pvp.blind': reduceBlind,
	'pvp.progress': reduceProgress,
	'pvp.voucher': reduceVoucher,
	'pvp.forfeit': reduceForfeit,
	'pvp.vote': reduceVote,
	'pvp.skip': reduceSkip,
}
