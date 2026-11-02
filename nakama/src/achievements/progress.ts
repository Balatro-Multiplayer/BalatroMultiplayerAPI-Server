// A player's achievement progress (stored in avatar_progress, storage.ts) and
// how one counted game moves it. Pure.
import type { AvatarId } from '../shared/avatars/ids'
import { isAvatarId } from '../shared/avatars/ids'
import { COUNTERS, MILESTONES, VANILLA_DECKS, type Counter, type Milestone, type SpdrnMode } from '../shared/avatars/rules'
import { spdrnModeOf } from './facts/setup'
import type { LogFacts } from './facts'

export const PROGRESS_SCHEMA = 1
// How many recent run ids are kept to make counting a run idempotent.
export const COUNTED_RUN_IDS_KEPT = 64
// A single hand scoring this much is the scoredOver1e11 milestone.
export const STUNT_SCORE = 1e11
// A Speedrun run faster than this is the sub8SpdrnRun milestone.
export const SUB_8_MS = 8 * 60 * 1000

// Counters stored as totals (bestWinStreak lives in winStreak).
export type StoredCounter = Exclude<Counter, 'bestWinStreak'>

export interface Progress {
	schema: number
	counters: { [counter in StoredCounter]: number }
	// Vanilla deck key -> games played with it.
	deckGames: { [deck: string]: number }
	spdrnModesPlayed: SpdrnMode[]
	// 'YYYY-MM-DD' (UTC) of the latest counted game.
	lastPlayedDay: string | null
	winStreak: { current: number; best: number }
	milestones: Milestone[]
	unlocked: AvatarId[]
	// The latest counted runs, newest last.
	countedRunIds: string[]
	// Private-lobby games counted today, per opponent set (eligibility.ts).
	privateGames: { day: string; counts: { [opponents: string]: number } }
	// Filled from the stored games once (backfill.ts); never filled again.
	backfilled: boolean
}

export type GameKind = 'pvp' | 'spdrn' | 'other'

// A game's result for the player: 'unknown' leaves the win streak alone (a
// disputed result, a draw, or no placement for them).
export type GameResult = 'win' | 'loss' | 'unknown'

export interface CountedGame {
	runId: string
	day: string
	kind: GameKind
	result: GameResult
	// Other players who were active in the game.
	activeOpponents: number
	metShowman: boolean
	// Sorted opponent ids, for a private lobby's daily cap; null otherwise.
	privateOpponentsKey: string | null
	facts: LogFacts
}

function storedCounters(): StoredCounter[] {
	return COUNTERS.filter((c): c is StoredCounter => c !== 'bestWinStreak')
}

export function emptyProgress(): Progress {
	const counters = {} as Progress['counters']
	for (const counter of storedCounters()) counters[counter] = 0
	return {
		schema: PROGRESS_SCHEMA,
		counters,
		deckGames: {},
		spdrnModesPlayed: [],
		lastPlayedDay: null,
		winStreak: { current: 0, best: 0 },
		milestones: [],
		unlocked: [],
		countedRunIds: [],
		privateGames: { day: '', counts: {} },
		backfilled: false,
	}
}

type Fields = { [field: string]: unknown }

const fieldsOf = (value: unknown): Fields =>
	value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : {}
const count = (value: unknown): number => (typeof value === 'number' && isFinite(value) && value > 0 ? value : 0)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

// The stored object as Progress, dropping anything unknown or malformed.
export function progressOf(value: unknown): Progress {
	const stored = fieldsOf(value)
	const base = emptyProgress()
	const counters = fieldsOf(stored.counters)
	for (const counter of storedCounters()) base.counters[counter] = count(counters[counter])
	const decks = fieldsOf(stored.deckGames)
	for (const deck of VANILLA_DECKS) if (count(decks[deck]) > 0) base.deckGames[deck] = count(decks[deck])
	const streak = fieldsOf(stored.winStreak)
	const privateGames = fieldsOf(stored.privateGames)
	const privateCounts = fieldsOf(privateGames.counts)
	const counts: { [key: string]: number } = {}
	for (const key in privateCounts) if (count(privateCounts[key]) > 0) counts[key] = count(privateCounts[key])
	return {
		...base,
		spdrnModesPlayed: strings(stored.spdrnModesPlayed)
			.map(spdrnModeOf)
			.filter((m): m is SpdrnMode => m !== null),
		lastPlayedDay: typeof stored.lastPlayedDay === 'string' ? stored.lastPlayedDay : null,
		winStreak: { current: count(streak.current), best: count(streak.best) },
		milestones: strings(stored.milestones).filter((m): m is Milestone => (MILESTONES as readonly string[]).indexOf(m) !== -1),
		unlocked: strings(stored.unlocked).filter(isAvatarId),
		countedRunIds: strings(stored.countedRunIds).slice(-COUNTED_RUN_IDS_KEPT),
		privateGames: { day: typeof privateGames.day === 'string' ? privateGames.day : '', counts },
		backfilled: stored.backfilled === true,
	}
}

// 'YYYY-MM-DD' in UTC.
export function utcDayOf(epochMs: number): string {
	return new Date(epochMs).toISOString().slice(0, 10)
}

export function withMilestone(progress: Progress, milestone: Milestone): Progress {
	if (progress.milestones.indexOf(milestone) !== -1) return progress
	return { ...progress, milestones: progress.milestones.concat([milestone]) }
}

export function withUnlocked(progress: Progress, ids: AvatarId[]): Progress {
	const fresh = ids.filter((id) => progress.unlocked.indexOf(id) === -1)
	return fresh.length === 0 ? progress : { ...progress, unlocked: progress.unlocked.concat(fresh) }
}

function streakAfter(streak: Progress['winStreak'], result: GameResult): Progress['winStreak'] {
	switch (result) {
		case 'win': {
			const current = streak.current + 1
			return { current, best: Math.max(streak.best, current) }
		}
		case 'loss':
			return { current: 0, best: streak.best }
		case 'unknown':
			return streak
	}
}

function privateGamesAfter(progress: Progress, game: CountedGame): Progress['privateGames'] {
	if (game.privateOpponentsKey === null) return progress.privateGames
	const counts = progress.privateGames.day === game.day ? { ...progress.privateGames.counts } : {}
	counts[game.privateOpponentsKey] = (counts[game.privateOpponentsKey] || 0) + 1
	return { day: game.day, counts }
}

// progress with one counted game added. A run already counted changes nothing.
export function applyGame(progress: Progress, game: CountedGame): Progress {
	if (progress.countedRunIds.indexOf(game.runId) !== -1) return progress
	const facts = game.facts
	const won = game.result === 'win'
	const c = progress.counters
	const newDay = progress.lastPlayedDay !== game.day
	const counters: Progress['counters'] = {
		...c,
		games: c.games + 1,
		wins: c.wins + (won ? 1 : 0),
		pvpGames: c.pvpGames + (game.kind === 'pvp' ? 1 : 0),
		spdrnGames: c.spdrnGames + (game.kind === 'spdrn' ? 1 : 0),
		winsVs3Plus: c.winsVs3Plus + (won && game.activeOpponents >= 3 ? 1 : 0),
		winsVs7Plus: c.winsVs7Plus + (won && game.activeOpponents >= 7 ? 1 : 0),
		hands: c.hands + facts.hands,
		rerolls: c.rerolls + facts.rerolls,
		moneySpent: c.moneySpent + facts.moneySpent,
		livesLost: c.livesLost + facts.livesLost,
		skips: c.skips + facts.skips,
		suitChangers: c.suitChangers + facts.suitChangers,
		smallworldGames: c.smallworldGames + (facts.setup.smallworld ? 1 : 0),
		daysPlayed: c.daysPlayed + (newDay ? 1 : 0),
	}
	const deckGames = { ...progress.deckGames }
	for (const deck of facts.setup.decks) deckGames[deck] = (deckGames[deck] || 0) + 1
	const mode = game.kind === 'spdrn' ? facts.setup.spdrnMode : null
	const spdrnModesPlayed =
		mode !== null && progress.spdrnModesPlayed.indexOf(mode) === -1
			? progress.spdrnModesPlayed.concat([mode])
			: progress.spdrnModesPlayed

	let next: Progress = {
		...progress,
		counters,
		deckGames,
		spdrnModesPlayed,
		lastPlayedDay: progress.lastPlayedDay === null || game.day > progress.lastPlayedDay ? game.day : progress.lastPlayedDay,
		winStreak: streakAfter(progress.winStreak, game.result),
		countedRunIds: progress.countedRunIds.concat([game.runId]).slice(-COUNTED_RUN_IDS_KEPT),
		privateGames: privateGamesAfter(progress, game),
	}
	if (facts.bestHandScore >= STUNT_SCORE) next = withMilestone(next, 'scoredOver1e11')
	if (game.kind === 'spdrn' && facts.fastestSpdrnRunMs !== null && facts.fastestSpdrnRunMs < SUB_8_MS)
		next = withMilestone(next, 'sub8SpdrnRun')
	if (game.metShowman) next = withMilestone(next, 'metShowman')
	return next
}
