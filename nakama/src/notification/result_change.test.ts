import { describe, expect, it } from 'vitest'
import type { RunRecord } from '../lobby/protocol'
import { outcomeOf, planResultNotifications } from './result_change'

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
	runId: 'r1',
	code: 'ABCDE',
	modId: 'M',
	seed: 'S',
	stake: 1,
	options: {},
	startedAt: 1,
	endedAt: 2,
	status: 'agreed',
	placements: [
		{ playerId: 'a', place: 1 },
		{ playerId: 'b', place: 2 },
	],
	reports: {},
	players: [
		{ id: 'a', displayName: 'A' },
		{ id: 'b', displayName: 'B' },
	],
	...over,
})
const contested = (over: Partial<RunRecord> = {}) =>
	run({
		status: 'contested',
		contest: { by: 'b', against: 'a', at: 1 },
		...over,
	})
const aWins = [
	{ playerId: 'a', place: 1 },
	{ playerId: 'b', place: 2 },
]
const bWins = [
	{ playerId: 'a', place: 2 },
	{ playerId: 'b', place: 1 },
]
const draw = [
	{ playerId: 'a', place: 1 },
	{ playerId: 'b', place: 1 },
]

describe('outcomeOf', () => {
	it('tells win, loss and draw', () => {
		expect(outcomeOf(aWins, 'a')).toBe('win')
		expect(outcomeOf(aWins, 'b')).toBe('loss')
		expect(outcomeOf(draw, 'a')).toBe('draw')
		expect(outcomeOf(draw, 'b')).toBe('draw')
		expect(outcomeOf(aWins, 'z')).toBeNull()
	})
	it('calls a shared best place in a bigger match a win, and all tied a draw', () => {
		const three = [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 1 },
			{ playerId: 'c', place: 2 },
		]
		expect(outcomeOf(three, 'a')).toBe('win')
		expect(outcomeOf(three, 'c')).toBe('loss')
	})
})

describe('planResultNotifications for a contest', () => {
	it('tells the contester and the opponent their own result', () => {
		const before = contested()
		const { sends } = planResultNotifications(
			before,
			{ ...before, placements: aWins },
			true,
		)
		expect(sends).toEqual([
			{
				userId: 'a',
				kind: 'contest_decided',
				params: { role: 'opponent', outcome: 'win' },
			},
			{
				userId: 'b',
				kind: 'contest_decided',
				params: { role: 'contester', outcome: 'loss' },
			},
		])
	})
	it('tells a draw to both', () => {
		const before = contested()
		const { sends } = planResultNotifications(
			before,
			{ ...before, placements: draw },
			true,
		)
		expect(sends.map((s) => s.params)).toEqual([
			{ role: 'opponent', outcome: 'draw' },
			{ role: 'contester', outcome: 'draw' },
		])
	})
	it('tells the void wording when the contest is decided by a void', () => {
		const before = contested()
		const { sends } = planResultNotifications(
			before,
			{ ...before, voided: { at: 5 } },
			true,
		)
		expect(sends.map((s) => s.kind)).toEqual(['result_voided', 'result_voided'])
	})
	it('tells the contest wording even when the reported result stands', () => {
		const before = contested({ placements: aWins })
		const { sends } = planResultNotifications(before, before, true)
		expect(sends).toHaveLength(2)
	})
	it('tells nothing when a reopened item is decided the same way', () => {
		const before = contested()
		const first = planResultNotifications(
			before,
			{ ...before, placements: aWins },
			true,
		)
		const second = planResultNotifications(
			{ ...before, placements: aWins, told: first.told },
			{ ...before, placements: aWins, told: first.told },
			true,
		)
		expect(second.sends).toEqual([])
	})
	it('tells again when a reopened item is decided differently', () => {
		const before = contested()
		const first = planResultNotifications(
			before,
			{ ...before, placements: aWins },
			true,
		)
		const reopened = { ...before, placements: aWins, told: first.told }
		const second = planResultNotifications(
			reopened,
			{ ...reopened, placements: bWins },
			true,
		)
		expect(
			second.sends.map((s) => [
				s.userId,
				(s.params as { outcome: string }).outcome,
			]),
		).toEqual([
			['a', 'loss'],
			['b', 'win'],
		])
	})
})

describe('planResultNotifications without a contest', () => {
	it('tells a void to each player', () => {
		const before = run()
		const { sends } = planResultNotifications(
			before,
			{ ...before, voided: { at: 5 } },
			false,
		)
		expect(sends).toEqual([
			{ userId: 'a', kind: 'result_voided', params: {} },
			{ userId: 'b', kind: 'result_voided', params: {} },
		])
	})
	it('tells a changed result, only to players whose result changed', () => {
		const three = (second: number, third: number) => [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: second },
			{ playerId: 'c', place: third },
		]
		const before = run({
			players: [...run().players, { id: 'c', displayName: 'C' }],
			placements: three(2, 3),
		})
		const { sends } = planResultNotifications(
			before,
			{ ...before, placements: three(3, 2) },
			false,
		)
		expect(sends).toEqual([])
		const swapped = planResultNotifications(
			before,
			{
				...before,
				placements: [
					{ playerId: 'a', place: 2 },
					{ playerId: 'b', place: 1 },
					{ playerId: 'c', place: 3 },
				],
			},
			false,
		)
		expect(swapped.sends.map((s) => s.userId)).toEqual(['a', 'b'])
	})
	it('uses the change wording on a contested run set from the match page', () => {
		const before = contested()
		const { sends } = planResultNotifications(
			before,
			{ ...before, placements: bWins },
			false,
		)
		expect(sends.map((s) => s.kind)).toEqual([
			'result_changed',
			'result_changed',
		])
	})
	it('tells nothing for a repeated void', () => {
		const before = run({ voided: { at: 5 } })
		expect(planResultNotifications(before, before, false).sends).toEqual([])
	})
	it('only tells the players of that match', () => {
		const before = run()
		const { sends } = planResultNotifications(
			before,
			{ ...before, placements: bWins },
			false,
		)
		expect(sends.every((s) => s.userId === 'a' || s.userId === 'b')).toBe(true)
	})
})
