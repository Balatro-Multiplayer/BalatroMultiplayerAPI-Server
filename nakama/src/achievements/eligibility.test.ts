import { describe, expect, it } from 'vitest'
import type { LogFacts } from './facts'
import type { RunRecord } from '../lobby/protocol'
import { A, B, C, facts, runOf } from '../testing/achievement_fixtures'
import { eligibilityOf, MIN_GAME_MS, PRIVATE_DAILY_CAP } from './eligibility'
import { emptyProgress } from './progress'



const both: { [userId: string]: LogFacts } = { [A]: facts(), [B]: facts() }
const DAY = '2026-10-19'
const judge = (run: RunRecord, playerId = A, f = both, progress = emptyProgress()) => eligibilityOf(run, playerId, f, false, progress, DAY)
const reason = (e: ReturnType<typeof judge>) => (e.kind === 'skipped' ? e.reason : 'counts')

describe('eligibility', () => {
	it('counts a finished game with its result', () => {
		const e = judge(runOf())
		expect(e.kind).toBe('counts')
		if (e.kind !== 'counts') return
		expect(e.game).toMatchObject({ runId: 'run-1', kind: 'pvp', result: 'win', activeOpponents: 1, privateOpponentsKey: null, day: DAY })
		const loser = judge(runOf(), B)
		expect(loser.kind === 'counts' && loser.game.result).toBe('loss')
	})

	it('counts partial games; a disputed one without its result', () => {
		expect(reason(judge(runOf({ status: 'partial' })))).toBe('counts')
		const disputed = judge(runOf({ status: 'disputed' }))
		expect(disputed.kind === 'counts' && disputed.game.result).toBe('unknown')
		const unplaced = judge(runOf({ placements: [] }))
		expect(unplaced.kind === 'counts' && unplaced.game.result).toBe('unknown')
	})

	it('counts a shared first place as a draw, not a win', () => {
		const draw = runOf({ placements: [{ playerId: A, place: 1 }, { playerId: B, place: 1 }] })
		const e = judge(draw)
		expect(e.kind === 'counts' && e.game.result).toBe('unknown')
		const players = [A, B, C].map((id) => ({ id, displayName: id }))
		const tiedFirst = runOf({ players, placements: [{ playerId: A, place: 1 }, { playerId: B, place: 1 }, { playerId: C, place: 3 }] })
		const third = judge(tiedFirst, C, { ...both, [C]: facts() })
		expect(third.kind === 'counts' && third.game.result).toBe('loss')
	})

	it('counts a winning team as a win', () => {
		const team = runOf({ placements: [{ playerId: A, place: 1, performance: 1 }, { playerId: B, place: 1, performance: 1 }] })
		const e = judge(team)
		expect(e.kind === 'counts' && e.game.result).toBe('win')
	})

	it('skips unfinished, flagged, already counted and non-participant runs', () => {
		expect(reason(judge(runOf({ status: 'abandoned' })))).toBe('not_finished')
		expect(reason(judge(runOf({ status: 'restarted' })))).toBe('not_finished')
		expect(reason(judge(runOf({ flags: { [A]: 'hash_mismatch' } })))).toBe('flagged')
		expect(reason(judge(runOf({ flags: { [B]: 'hash_mismatch' } })))).toBe('counts')
		expect(reason(judge(runOf(), A, both, { ...emptyProgress(), countedRunIds: ['run-1'] }))).toBe('already_counted')
		expect(reason(judge(runOf(), C))).toBe('not_participant')
	})

	it('needs a real game: hands, length and two active players', () => {
		expect(reason(judge(runOf(), A, { [A]: facts({ hands: 2 }), [B]: facts() }))).toBe('too_few_hands')
		expect(reason(judge(runOf(), A, { [B]: facts() }))).toBe('too_few_hands')
		expect(reason(judge(runOf({ endedAt: runOf().startedAt + MIN_GAME_MS - 1 })))).toBe('too_short')
		expect(reason(judge(runOf(), A, { [A]: facts(), [B]: facts({ hands: 0 }) }))).toBe('too_few_active')
	})

	it('counts only active opponents, for the win-against goals', () => {
		const players = [A, B, C, 'd', 'e'].map((id) => ({ id, displayName: id }))
		const e = judge(runOf({ players }), A, { [A]: facts(), [B]: facts(), [C]: facts(), d: facts({ hands: 0 }) })
		expect(e.kind === 'counts' && e.game.activeOpponents).toBe(2)
	})

	it('caps private games per day per opponent set', () => {
		const run = runOf({ lobbyType: 'private' })
		const e = judge(run)
		expect(e.kind === 'counts' && e.game.privateOpponentsKey).toBe(B)
		const capped = { ...emptyProgress(), privateGames: { day: DAY, counts: { [B]: PRIVATE_DAILY_CAP } } }
		expect(reason(judge(run, A, both, capped))).toBe('private_cap')
		// A new day, or a different opponent set, is not capped.
		expect(reason(judge(run, A, both, { ...capped, privateGames: { day: '2026-10-18', counts: { [B]: PRIVATE_DAILY_CAP } } }))).toBe('counts')
		const three = runOf({ lobbyType: 'private', players: [A, B, C].map((id) => ({ id, displayName: id })) })
		expect(reason(judge(three, A, { ...both, [C]: facts() }, capped))).toBe('counts')
		// Older run records without a lobby type are treated as private.
		expect(reason(judge(runOf({ lobbyType: undefined }), A, both, capped))).toBe('private_cap')
	})

	it('names the game kind from the mod', () => {
		const spdrn = judge(runOf({ modId: 'MultiplayerSPDRN' }))
		expect(spdrn.kind === 'counts' && spdrn.game.kind).toBe('spdrn')
		const other = judge(runOf({ modId: 'cctl_test' }))
		expect(other.kind === 'counts' && other.game.kind).toBe('other')
	})
})
