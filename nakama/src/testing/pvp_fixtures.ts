// Shared test builders for the refereed PvP state. A seat is made with every fact
// unknown (null); a test that needs a started player says so here, in one place,
// the way a client's pvp.blind_start and pvp.progress would.
import type { PvpLastStart } from '../lobby/protocol'
import { FACT_REDUCERS } from '../lobby/pvp/facts'
import {
	type OpponentState,
	seedOpponentFacts,
} from '../lobby/pvp/opponent_state'
import {
	type PvpLifePlayer,
	type PvpMode,
	type PvpRoundPlayer,
	type PvpTeam,
	type RefereeState,
	type StoredPvp,
	emptyFacts,
	emptyPvp,
} from '../lobby/pvp/state'
import { type Lobby, join, newLobby } from '../lobby/state'
import { PVP_MOD_ID } from '../standing/pvp_version'
import { withRules } from './pvp_rules'
import { settingsAtStart } from './pvp_settings'

// A player who reported their blind's start: score, hands, ante.
export function reportedPlayer(
	over: Partial<PvpRoundPlayer> = {},
): PvpRoundPlayer {
	return {
		score: '0',
		handsLeft: 4,
		highestScore: '0',
		ante: 1,
		furthestBlind: 0,
		reportedHands: 4,
		reportedApplied: 0,
		timerLosses: 0,
		handsSpent: false,
		committedHands: null,
		creditedHands: null,
		pvpLeftMs: null,
		...over,
	}
}

// Every seated player reports their blind's start the way a client does: a
// pvp.blind_start (score 0, `hands` hands) and a pvp.progress (`ante`), run
// through the real reducers. A report a reducer refuses (the round is not playing,
// the player is out) is not made: that fact stays unknown, as it would for a client.
export function reportAll(
	state: RefereeState,
	hands = 4,
	ante = 1,
): RefereeState {
	let next = state
	const base = { runId: state.runId, roundId: state.round.roundId }
	for (const [id, p] of Object.entries(state.round.players)) {
		if (p.reportedHands === null) {
			const r = FACT_REDUCERS['pvp.blind_start'](next, id, {
				...base,
				handsLeft: hands,
				score: '0',
				timerLossesApplied: 0,
			})
			if (r.ok) next = r.state
		}
		if (p.ante === null) {
			const r = FACT_REDUCERS['pvp.progress'](next, id, {
				...base,
				ante,
				furthestBlind: 0,
			})
			if (r.ok) next = r.state
		}
	}
	return next
}

// A `lastStart` of `ids` readying in order, each on the Boss of `ante`.
export function startOf(
	ids: string[],
	roundId = 1,
	firstPlayer: string | null = ids.length > 0 ? ids[0] : null,
	ante = 1,
): PvpLastStart {
	const blindKeys: { [id: string]: string } = {}
	for (const id of ids) blindKeys[id] = `${ante}:Boss`
	return { roundId, firstPlayer, players: [...ids], blindKeys }
}

// A seat that has reported nothing: every game fact unknown (what the tick seats).
export function unreportedPlayer(
	over: Partial<PvpRoundPlayer> = {},
): PvpRoundPlayer {
	return {
		score: null,
		handsLeft: null,
		highestScore: null,
		ante: null,
		furthestBlind: null,
		reportedHands: null,
		reportedApplied: 0,
		timerLosses: 0,
		handsSpent: false,
		committedHands: null,
		creditedHands: null,
		pvpLeftMs: null,
		...over,
	}
}

// The queue mode that freezes to each mode.
const QUEUE_OF: { [mode in PvpMode]: string } = {
	royale: 'pvp_royale',
	nemesis: 'pvp_nemesis',
	manhunt: 'pvp_manhunt',
	teams: 'pvp_teams',
}

export interface OpponentFixtureOpts {
	mode?: PvpMode
	ids?: string[]
	// The first ante whose Boss is the PvP blind.
	pvpStartAnte?: number
	roundId?: number
	// Each player's server ante (round.players[id].ante); a missing id is at ante 1, null
	// is a player who reported no progress.
	antes?: { [id: string]: number | null }
	// Round scores, for the modes that rank (Royale, Manhunt's Runner).
	scores?: { [id: string]: string | null }
	// Nemesis: the stored partners; Teams: the drawn card targets.
	partners?: { [id: string]: string | null }
	cardTargets?: { [id: string]: string | null }
	teams?: { [id: string]: PvpTeam }
	// Seats that are out of the run.
	out?: string[]
	// The run total of skips each player's pvp.skip last reported; null is a player
	// who has reported none (unknown), a missing id is 0.
	skips?: { [id: string]: number | null }
	// The ruleset the game froze (default balanced), e.g. 'ruleset_mp_legacy_ranked'.
	ruleset?: string
}

// A running PvP game with the opponent records seeded for `ids`, as the tick's `freeze`
// leaves it: the rules frozen from real settings, a seat and a round entry per id.
export function opponentState(opts: OpponentFixtureOpts = {}): OpponentState {
	const mode = opts.mode ?? 'nemesis'
	const ids = opts.ids ?? ['a', 'b']
	const runId = 'run-1'
	const settings = settingsAtStart(
		withRules({
			ruleset: opts.ruleset ?? 'ruleset_mp_balanced',
			queue_mode: QUEUE_OF[mode],
			...(opts.pvpStartAnte === undefined
				? {}
				: { pvp_start_round: opts.pvpStartAnte }),
		}),
		ids,
	)
	const round: RefereeState['round']['players'] = {}
	const players: RefereeState['lives']['players'] = {}
	const skips: RefereeState['facts']['skips'] = {}
	for (const id of ids) {
		const ante = opts.antes?.[id] === undefined ? 1 : opts.antes[id]
		const score = opts.scores?.[id] ?? null
		round[id] =
			ante === null
				? unreportedPlayer({ score })
				: reportedPlayer({ ante, score })
		players[id] = {
			lives: 3,
			eliminated: opts.out?.includes(id) ?? false,
			forfeited: false,
			left: false,
			events: [],
		}
		skips[id] = {
			skips: opts.skips !== undefined && id in opts.skips ? opts.skips[id] : 0,
			skipsAtPvp: 0,
			facing: null,
			spentMs: 0,
		}
	}
	const view = emptyPvp()
	const base: RefereeState = {
		...view,
		rules: { runId, ...settings, mode },
		round: {
			runId,
			roundId: opts.roundId ?? 1,
			phase: 'playing',
			players: round,
			lastResult: null,
		},
		lives: { runId, players, teamLives: null, pending: [] },
		teams: { runId, teams: opts.teams ?? {} },
		pairing:
			opts.partners === undefined
				? null
				: { ante: 1, partners: opts.partners, usedPairs: [], lastBye: null },
		cardTargets:
			opts.cardTargets === undefined
				? null
				: { ante: 1, targets: opts.cardTargets },
		facts: { ...emptyFacts(), skips },
		runId,
		lastStart: startOf(ids, opts.roundId ?? 1),
	}
	return { ...base, facts: { ...base.facts, ...seedOpponentFacts(ids) } }
}

// The state at server round `roundId` (the window the plausibility caps count in).
export function atRound(state: OpponentState, roundId: number): OpponentState {
	return { ...state, round: { ...state.round, roundId } }
}

// The state with `id` at server ante `ante` (null: no progress reported).
export function atAnte(
	state: OpponentState,
	id: string,
	ante: number | null,
): OpponentState {
	const entry = ante === null ? unreportedPlayer() : reportedPlayer({ ante })
	return {
		...state,
		round: {
			...state.round,
			players: { ...state.round.players, [id]: entry },
		},
	}
}

// The state with `id` out of the run (eliminated).
export function withOut(state: OpponentState, id: string): OpponentState {
	const seat = state.lives.players[id]
	return {
		...state,
		lives: {
			...state.lives,
			players: { ...state.lives.players, [id]: { ...seat, eliminated: true } },
		},
	}
}

// A started PvP lobby with every stored key filled in, as a checkpoint holds it: the
// shape drift tests (lobby/checkpoint.test.ts) read its key paths. Dynamic map keys
// are the seat ids `ua` and `ub` and the blind keys `1:Small` and `1:Boss`. Server
// times are relative to a checkpoint taken at t = 50 000: a running PvP deadline ends
// at 70 000, two Speedlatro clocks started counting at 40 000 and 45 000, one with a
// grace until 53 000. `paused` gives the deadline the time it was paused with; `draft` opens a Draft step
// where the Vote one is open. Setup results hold one Draft (`d1`) and one Vote (`v1`).
export function populatedPvpLobby(opts: { paused?: boolean; draft?: boolean } = {}): Lobby {
	const base = newLobby({
		code: 'POP123',
		modId: PVP_MOD_ID,
		maxPlayers: 4,
		creatorId: 'ua',
		allowedIds: ['ua', 'ub'],
		gameMode: 'ranked:pvp_standard',
		rankedMode: 'ranked_standard',
		now: 1000,
		graceMs: 60_000,
	})
	const info = (name: string) => ({
		displayName: name,
		preferredJoker: null,
		mods: null,
		pvpVersion: '1.0.5',
	})
	let lobby = join(base, 'ua', 'ua-s', info('ua'), 1000).lobby
	lobby = join(lobby, 'ub', 'ub-s', info('ub'), 1000).lobby
	const seat = (over: Partial<PvpLifePlayer> = {}): PvpLifePlayer => ({
		lives: 3,
		eliminated: false,
		forfeited: false,
		left: false,
		events: [{ delta: -1, key: '1:Boss' }],
		...over,
	})
	const record = { beaten: true, roundLost: false }
	const referee: Omit<RefereeState, 'runId' | 'lastStart'> = {
		rules: {
			runId: 'run-1',
			mode: 'royale',
			startedCount: 2,
			startingLives: 4,
			hunterLives: 3,
			pvpStartAnte: 2,
			deathOnRoundLoss: false,
			clocks: {
				ante: 'personal',
				pvp: { baseMs: 60_000, handMs: 20_000 },
				personal: {
					kind: 'speedlatro',
					baseMs: 120_000,
					pvpMs: 60_000,
					graceMs: 3000,
					timedRate: 2,
					previewCostMs: 1000,
				},
			},
			timerBaseMs: 150_000,
			timerForgiveness: 1,
			timerIncrementMs: 5000,
			skipTimeRule: 'lead',
		},
		round: {
			runId: 'run-1',
			roundId: 2,
			phase: 'playing',
			players: {
				ua: reportedPlayer({ score: '10', handsLeft: 3, ante: 2, furthestBlind: 1 }),
				ub: unreportedPlayer(),
			},
			lastResult: { roundId: 1, losers: ['ub'] },
		},
		lives: {
			runId: 'run-1',
			players: { ua: seat(), ub: seat({ lives: 1 }) },
			teamLives: { A: 4, B: 4 },
			pending: [{ playerId: 'ub', blindKey: '1:Boss', waitsOn: ['ua'] }],
		},
		teams: { runId: 'run-1', teams: { ua: 'A', ub: 'B' } },
		votes: { runId: 'run-1', draw: ['ua'], seed: ['ub'] },
		result: {
			runId: 'run-1',
			kind: 'win',
			winnerId: 'ua',
			winnerTeam: 'A',
			places: [{ playerId: 'ua', place: 1 }],
		},
		pairing: { ante: 1, partners: { ua: 'ub', ub: null }, usedPairs: ['ua|ub'], lastBye: 'ub' },
		cardTargets: { ante: 1, targets: { ua: 'ub', ub: null } },
		facts: {
			log: [
				{ type: 'blind', playerId: 'ua', blindKey: '1:Boss', beaten: true, roundLost: false },
				{ type: 'hand_credit', playerId: 'ua', hands: 1 },
				{ type: 'timer_start', playerId: 'ua', kind: 'pvp' },
				{ type: 'timer_pause', playerId: 'ua' },
				{ type: 'preview_charge', playerId: 'ua' },
				{ type: 'voucher', playerId: 'ua', voucherKey: 'v_x' },
				{ type: 'forfeit', playerId: 'ub' },
			],
			applied: 3,
			blinds: { ua: { '1:Small': record, '1:Boss': record } },
			handRound: { ua: 2 },
			animating: ['ub'],
			skips: { ua: { skips: 1, skipsAtPvp: 0, facing: 'ub', spentMs: 1000 } },
			guarded: { ua: ['1:Boss'] },
			pvpBlinds: { ua: ['1:Boss'] },
			anteSeen: 1,
			deaths: [{ playerId: 'ub', blindKey: '1:Boss', outBefore: { ua: false } }],
			deadline: {
				kind: 'pvp',
				by: 'ua',
				against: ['ub'],
				endsAt: 70_000,
				shownMs: 20_000,
				n: 3,
				...(opts.paused ? { pausedMs: 20_000 } : {}),
			},
			timerN: 3,
			forgiven: { ua: 1 },
			clocks: {
				ua: { ms: 90_000, running: true, rate: 2, n: 4, spent: false, since: 40_000, graceUntil: 53_000 },
				ub: { ms: 80_000, running: false, rate: 1, n: 2, spent: true, since: 45_000, graceUntil: null },
			},
			skipsSeen: { ua: { rival: 'ub', skips: 2 }, ub: { rival: null } },
			nemesis: {
				ua: { '2': { each: ['ub'], one: 'ub' } },
				ub: { '1': { each: [], one: null } },
			},
			opponent: {
				players: {
					ua: {
						sells: { '2': 3 },
						slots: [
							{ ante: 2, spent: 4 },
							{ ante: 2, skipped: true },
							{ ante: 2, refused: 'implausible' },
						],
						closed: false,
					},
					ub: { sells: {}, slots: [], closed: true },
				},
			},
			server: {
				players: {
					ua: { seenAnte: 2 },
					ub: { seenAnte: null },
				},
			},
			effects: {
				players: {
					ua: { incoming: [] },
					ub: { incoming: [{ from: 'ua', n: 1, kind: 'asteroid', amount: 1 }] },
				},
			},
			traps: {
				trapSeq: 2,
				traps: [
					{ id: 0, key: 'c_x', owner: 'ua', holder: 'ub', state: 'live' },
					{ id: 1, key: 'c_y', owner: 'ub', holder: 'ua', state: { fired: { bounced: 'ub' } } },
				],
			},
		},
	}
	const pvp: StoredPvp = {
		runId: 'run-1',
		round: 2,
		ready: { ua: true },
		firstReady: 'ua',
		blindKeys: { ua: '1:Boss' },
		order: ['ua'],
		readied: ['ua', 'ub'],
		lastStart: startOf(['ua', 'ub'], 2),
		referee,
	}
	return {
		...lobby,
		spectators: ['uc'],
		teamPlan: [['ua'], ['ub']],
		actionBudget: { ua: { tokens: 5, at: 1200 } },
		chat: [{ senderId: 'ua', text: 'gl', displayName: 'ua', at: 1500 }],
		lastRunId: 'run-0',
		catchUpLimitMs: 30_000,
		teamPicks: { ua: 'A' },
		forfeitedSeats: { ud: 'run-0' },
		rev: 7,
		connSeq: 3,
		groupsReleased: false,
		groups: [{ partyId: 'p1', homeCode: 'HOME12', memberIds: ['ua', 'ub'] }],
		groupQueue: {
			phase: 'away',
			partyId: 'p1',
			mode: 'pvp_standard',
			teams: false,
			memberIds: ['ua', 'ub'],
			since: 1000,
			matchId: 'm1',
			code: 'POP123',
			until: 90_000,
		},
		game: {
			...lobby.game,
			ready: { ua: true },
			started: {
				runId: 'run-1',
				seed: 'seed',
				stake: 1,
				options: null,
				startedAt: 2000,
				raceStartedAt: 3000,
				hostId: 'ua',
				players: [
					{ id: 'ua', displayName: 'ua', avatar: 'av' },
					{ id: 'ub', displayName: 'ub' },
				],
			},
			reports: { ua: [] },
			reportOrder: ['ua'],
			settleFrom: 4000,
			logs: { ua: { lines: ['l'], bytes: 1, truncated: false, seq: 1, ahead: 2 } },
			setup: {
				open: opts.draft
					? {
							kind: 'draft',
							id: 'd2',
							pool: [{ key: 'j_a', stake: 2 }],
							banned: ['j_b'],
							order: ['ua', 'ub'],
							first: 0,
							schedule: [{ actor: 1, action: 'ban', count: 1 }],
							turn: 0,
							remaining: 1,
							turnMs: 30_000,
							deadline: 60_000,
						}
					: { kind: 'vote', id: 'v2', options: ['x'], voters: ['ua', 'ub'], votes: { ua: 'x' }, deadline: 60_000 },
				results: {
					d1: { kind: 'draft', survivors: [{ key: 'j_a', stake: 2 }], banned: ['j_b'] },
					v1: { kind: 'vote', option: 'x', counts: { x: 1 } },
				},
			},
			resultPending: true,
			resultWasPending: true,
			contest: { by: 'ua', against: 'ub', at: 5000 },
			runSaves: { ua: { id: 's1', pos: 1, hash: 'h', data: 'd', at: 6000 } },
			runSavePending: { ub: { id: 's2', count: 2, pos: 1, hash: 'h', parts: { '0': 'x' } } },
			presence: [{ userId: 'ub', kind: 'kicked', at: 7000, by: 'ua', reason: 'r' }],
			pvp,
		},
	}
}

// The lobby after its first replay event: the moment the run begins and the rules freeze.
export const raced = (lobby: Lobby, at = 1500): Lobby => ({
	...lobby,
	game: {
		...lobby.game,
		started: lobby.game.started
			? { ...lobby.game.started, raceStartedAt: at }
			: lobby.game.started,
	},
})
