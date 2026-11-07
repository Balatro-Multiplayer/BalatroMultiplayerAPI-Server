import { describe, expect, it } from 'vitest'
import {
	chatLabelRows,
	dismissLabelOf,
	flaggedSourceId,
	guardReadingOf,
	labelOfAction,
	labelsCsv,
	linesBefore,
	membersOf,
	nextRound,
	summaryOf,
} from '../../features/service-queue/flagged-chat.js'

describe('flagged chat item key', () => {
	it('keys an item by lobby, player and round', () => {
		expect(flaggedSourceId('lobby-1', 'p1', 1)).toBe('lobby-1:p1')
		expect(flaggedSourceId('lobby-1', 'p1', 2)).toBe('lobby-1:p1:2')
	})

	it('numbers the next round after the highest one already used', () => {
		expect(nextRound('lobby-1:p1', [])).toBe(1)
		expect(nextRound('lobby-1:p1', ['lobby-1:p1'])).toBe(2)
		expect(
			nextRound('lobby-1:p1', ['lobby-1:p1', 'lobby-1:p1:2', 'lobby-1:p10']),
		).toBe(3)
	})
})

describe('flagged chat members', () => {
	it('reads the message ids an item holds', () => {
		expect(membersOf({ flaggedMessageIds: [4, 7] }, '4:x')).toEqual([4, 7])
	})

	it('reads an item from before grouping as its one message', () => {
		expect(membersOf({}, '42')).toEqual([42])
		expect(membersOf({}, 'lobby:p1')).toEqual([])
	})

	it('words the summary by message count', () => {
		expect(summaryOf(1)).toBe('Flagged chat, 1 message')
		expect(summaryOf(3)).toBe('Flagged chat, 3 messages')
	})
})

describe('guard reading', () => {
	it('takes the guard score and the band from a judged line', () => {
		expect(
			guardReadingOf({
				verdict: 'allow',
				band: 'review',
				guardScore: 0.42,
				guardSafety: 'unsafe',
				guardContextUsed: true,
			}),
		).toEqual({
			score: 0.42,
			band: 'review',
			safety: 'unsafe',
			contextUsed: true,
		})
	})

	it('has no score for an older line or a word-list flag', () => {
		expect(guardReadingOf({ source: 'local', matches: [] })).toEqual({
			score: null,
			band: null,
			safety: null,
			contextUsed: null,
		})
		expect(guardReadingOf(null)).toEqual({
			score: null,
			band: null,
			safety: null,
			contextUsed: null,
		})
	})
})

describe('labels', () => {
	it('knows the dismiss buttons', () => {
		expect(dismissLabelOf('not_harmful')).toBe('not_harmful')
		expect(dismissLabelOf('harmful_no_action')).toBe('harmful_no_action')
		expect(dismissLabelOf('harmful')).toBeNull()
		expect(dismissLabelOf(undefined)).toBeNull()
	})

	it('labels a warning or chat ban harmful and a dismiss by its button', () => {
		expect(labelOfAction('warn', null)).toBe('harmful')
		expect(labelOfAction('chat_mute', null)).toBe('harmful')
		expect(labelOfAction('dismiss', 'not_harmful')).toBe('not_harmful')
		expect(labelOfAction('resolve', null)).toBeNull()
		expect(labelOfAction('queue_ban', null)).toBeNull()
	})

	it('takes the lines said before a message, oldest first, up to a limit', () => {
		const lines = [1, 2, 3, 4].map((id) => ({ id, message: `m${id}` }))
		expect(linesBefore(lines, 4, 2)).toEqual(['m2', 'm3'])
		expect(linesBefore(lines, 1, 2)).toEqual([])
		expect(linesBefore(lines, 99, 2)).toEqual([])
	})

	it('makes one label row for each flagged message', () => {
		const at = new Date('2026-01-01T00:00:00Z')
		const rows = chatLabelRows({
			itemId: 5,
			label: 'not_harmful',
			decidedAt: at,
			members: [
				{
					flaggedMessageId: 1,
					message: 'a',
					context: ['x'],
					verdict: { band: 'review', guardScore: 0.5 },
				},
				{ flaggedMessageId: 2, message: 'b', context: [], verdict: null },
			],
		})
		expect(rows).toEqual([
			{
				itemId: 5,
				flaggedMessageId: 1,
				message: 'a',
				context: ['x'],
				score: 0.5,
				band: 'review',
				label: 'not_harmful',
				decidedAt: at,
			},
			{
				itemId: 5,
				flaggedMessageId: 2,
				message: 'b',
				context: [],
				score: null,
				band: null,
				label: 'not_harmful',
				decidedAt: at,
			},
		])
	})
})

describe('label export', () => {
	it('writes a header and one quoted row for each label', () => {
		const csv = labelsCsv([
			{
				message: 'say "hi", ok',
				context: ['a', 'b'],
				score: 0.25,
				band: 'review',
				label: 'not_harmful',
				decidedAt: new Date('2026-01-01T00:00:00Z'),
			},
			{
				message: 'plain',
				context: [],
				score: null,
				band: null,
				label: 'harmful',
				decidedAt: new Date('2026-01-02T00:00:00Z'),
			},
		])
		expect(csv).toBe(
			'message,context,score,band,label,decided_at\r\n' +
				'"say ""hi"", ok","[""a"",""b""]",0.25,review,not_harmful,2026-01-01T00:00:00.000Z\r\n' +
				'plain,[],,,harmful,2026-01-02T00:00:00.000Z\r\n',
		)
	})
})
