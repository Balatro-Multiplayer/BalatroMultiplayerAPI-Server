import { describe, expect, it, vi } from 'vitest'
import {
	type MatchEditDeps,
	type MatchRow,
	editMatch,
	matchAtTarget,
} from '../../features/ratings/match-edit.service.js'

const A = 'player-a'
const B = 'player-b'
const NA = 'nakama-a'
const NB = 'nakama-b'
const REPORTED = new Date('2026-11-01T12:00:00Z')

const match = (over: Partial<MatchRow> = {}): MatchRow => ({
	matchId: 'run-1',
	modId: 'M',
	gameMode: 'ranked:duel',
	status: 'resolved',
	resultPlacements: [
		{ playerId: A, place: 1 },
		{ playerId: B, place: 1 },
	],
	resultReportedAt: REPORTED,
	...over,
})

const aWins = [
	{ playerId: A, place: 1 },
	{ playerId: B, place: 2 },
]

function setup(row: MatchRow | null, over: Partial<MatchEditDeps> = {}) {
	const deps = {
		findMatch: vi.fn(async () => row),
		seasonAt: vi.fn(async () => 3),
		nakamaIdsOf: vi.fn(
			async () =>
				new Map([
					[A, NA],
					[B, NB],
				]),
		),
		playerIdsOf: vi.fn(
			async () =>
				new Map([
					[NA, A],
					[NB, B],
				]),
		),
		editRun: vi.fn(async () => ({
			ok: true as const,
			value: {
				applied: true,
				changes: {
					[NA]: {
						oldDelta: 0,
						newDelta: 20,
						rating: 20,
						wins: 0,
						losses: 0,
						gamesPlayed: 0,
					},
					[NB]: {
						oldDelta: 0,
						newDelta: -20,
						rating: -20,
						wins: -1,
						losses: 1,
						gamesPlayed: 0,
					},
				},
			},
		})),
		applyRows: vi.fn(async () => {}),
		...over,
	} satisfies MatchEditDeps
	return deps
}

describe('editMatch', () => {
	it('tells Nakama a contest is being decided', async () => {
		const deps = setup(match({ status: 'resolved' }))
		await editMatch(deps, { runId: 'run-1', matchmade: true, decidesContest: true }, { kind: 'void' })
		expect(deps.editRun).toHaveBeenCalledWith(expect.objectContaining({ decidesContest: true }))
	})

	it('sends the Nakama ids of the players whose Contests stand', async () => {
		const deps = setup(match({ status: 'resolved' }))
		await editMatch(deps, { runId: 'run-1', matchmade: true, decidesContest: true, contesterIds: [B] }, { kind: 'void' })
		const body = (deps.editRun as ReturnType<typeof vi.fn>).mock.calls[0][0]
		expect(body.contesters).toEqual([NB])
	})

	it('does not send decidesContest for an ordinary edit', async () => {
		const deps = setup(match({ status: 'resolved' }))
		await editMatch(deps, { runId: 'run-1', matchmade: true }, { kind: 'void' })
		expect(deps.editRun).toHaveBeenCalledWith(expect.not.objectContaining({ decidesContest: expect.anything() }))
	})

	it('sets a ranked result: Nakama first with the season, then the rows with the rating changes', async () => {
		const deps = setup(match())
		const outcome = await editMatch(
			deps,
			{ runId: 'run-1', matchmade: true },
			{ kind: 'result', placements: aWins },
		)
		expect(deps.editRun).toHaveBeenCalledWith({
			runId: 'run-1',
			season: 3,
			placements: [
				{ playerId: NA, place: 1 },
				{ playerId: NB, place: 2 },
			],
		})
		expect(deps.applyRows).toHaveBeenCalledWith(
			match(),
			{ kind: 'result', placements: aWins },
			[
				{
					playerId: A,
					oldDelta: 0,
					newDelta: 20,
					rating: 20,
					wins: 0,
					losses: 0,
					gamesPlayed: 0,
				},
				{
					playerId: B,
					oldDelta: 0,
					newDelta: -20,
					rating: -20,
					wins: -1,
					losses: 1,
					gamesPlayed: 0,
				},
			],
			3,
			false,
		)
		expect(outcome).toMatchObject({
			kind: 'edited',
			rerated: true,
			summary: {
				previous: [
					{ playerId: A, place: 1 },
					{ playerId: B, place: 1 },
				],
				next: aWins,
				ratingChanges: [
					{ playerId: A, newDelta: 20 },
					{ playerId: B, newDelta: -20 },
				],
			},
		})
	})

	it('tells the rows when a contested game was rated for the first time', async () => {
		const deps = setup(match(), {
			editRun: vi.fn(async () => ({
				ok: true as const,
				value: {
					applied: true,
					changes: {
						[NA]: {
							oldDelta: null,
							newDelta: 20,
							rating: 20,
							wins: 1,
							losses: 0,
							gamesPlayed: 1,
						},
					},
				},
			})),
		})
		await editMatch(
			deps,
			{ runId: 'run-1', matchmade: true },
			{ kind: 'result', placements: aWins },
		)
		expect(deps.applyRows).toHaveBeenCalledWith(
			match(),
			expect.anything(),
			expect.anything(),
			3,
			true,
		)
	})

	it('voids a ranked match and takes back its rating changes', async () => {
		const deps = setup(match())
		const outcome = await editMatch(
			deps,
			{ runId: 'run-1', matchmade: true },
			{ kind: 'void' },
		)
		expect(deps.editRun).toHaveBeenCalledWith({
			runId: 'run-1',
			season: 3,
			void: true,
		})
		expect(outcome).toMatchObject({
			kind: 'edited',
			rerated: true,
			summary: { next: null },
		})
	})

	it('changes no rating for a casual match', async () => {
		const deps = setup(match({ gameMode: 'duel' }), {
			editRun: vi.fn(async () => ({
				ok: true as const,
				value: { applied: true, changes: {} },
			})),
		})
		const outcome = await editMatch(
			deps,
			{ runId: 'run-1', matchmade: true },
			{ kind: 'result', placements: aWins },
		)
		expect(deps.seasonAt).not.toHaveBeenCalled()
		expect(deps.editRun).toHaveBeenCalledWith(
			expect.not.objectContaining({ season: expect.anything() }),
		)
		expect(outcome).toMatchObject({
			kind: 'edited',
			rerated: false,
			summary: { ratingChanges: [] },
		})
	})

	it('sends no season for a voided match, so a retried void takes nothing back twice', async () => {
		const deps = setup(match({ status: 'voided' }))
		await editMatch(deps, { runId: 'run-1', matchmade: true }, { kind: 'void' })
		expect(deps.editRun).toHaveBeenCalledWith({ runId: 'run-1', void: true })
	})

	it('edits a private game in Nakama only', async () => {
		const deps = setup(null, {
			editRun: vi.fn(async () => ({
				ok: true as const,
				value: { applied: true, changes: {} },
			})),
		})
		const outcome = await editMatch(
			deps,
			{ runId: 'run-p', matchmade: false },
			{ kind: 'result', placements: aWins },
		)
		expect(deps.findMatch).not.toHaveBeenCalled()
		expect(deps.applyRows).not.toHaveBeenCalled()
		expect(outcome).toMatchObject({ kind: 'edited', rerated: false })
	})

	it('refuses a missing match, an unresolved one, and a result for a voided one', async () => {
		expect(
			await editMatch(
				setup(null),
				{ runId: 'x', matchmade: true },
				{ kind: 'void' },
			),
		).toEqual({ kind: 'not_found' })
		expect(
			await editMatch(
				setup(match({ status: 'active' })),
				{ runId: 'x', matchmade: true },
				{ kind: 'void' },
			),
		).toEqual({
			kind: 'not_resolved',
			status: 'active',
		})
		expect(
			await editMatch(
				setup(match({ status: 'voided' })),
				{ runId: 'x', matchmade: true },
				{ kind: 'result', placements: aWins },
			),
		).toEqual({ kind: 'not_resolved', status: 'voided' })
	})

	it('fails without touching Nakama when a player has no Nakama account', async () => {
		const deps = setup(match(), {
			nakamaIdsOf: vi.fn(async () => new Map([[A, NA]])),
		})
		const outcome = await editMatch(
			deps,
			{ runId: 'run-1', matchmade: true },
			{ kind: 'result', placements: aWins },
		)
		expect(outcome).toMatchObject({ kind: 'failed' })
		expect(deps.editRun).not.toHaveBeenCalled()
	})

	it('fails without touching the rows when Nakama refuses', async () => {
		const deps = setup(match(), {
			editRun: vi.fn(async () => ({ ok: false as const, error: 'rejected' })),
		})
		const outcome = await editMatch(
			deps,
			{ runId: 'run-1', matchmade: true },
			{ kind: 'void' },
		)
		expect(outcome).toEqual({
			kind: 'failed',
			reason: 'admin_match_edit rejected',
		})
		expect(deps.applyRows).not.toHaveBeenCalled()
	})

	it('fails when a ranked match has no season', async () => {
		const deps = setup(match(), { seasonAt: vi.fn(async () => null) })
		expect(
			await editMatch(
				deps,
				{ runId: 'run-1', matchmade: true },
				{ kind: 'void' },
			),
		).toMatchObject({ kind: 'failed' })
		expect(deps.editRun).not.toHaveBeenCalled()
	})
})

describe('matchAtTarget', () => {
	it('is true once the row holds the result or the void', () => {
		expect(matchAtTarget(match(), { kind: 'result', placements: aWins })).toBe(
			false,
		)
		expect(
			matchAtTarget(match({ resultPlacements: aWins }), {
				kind: 'result',
				placements: aWins,
			}),
		).toBe(true)
		expect(matchAtTarget(match(), { kind: 'void' })).toBe(false)
		expect(matchAtTarget(match({ status: 'voided' }), { kind: 'void' })).toBe(
			true,
		)
	})
})
