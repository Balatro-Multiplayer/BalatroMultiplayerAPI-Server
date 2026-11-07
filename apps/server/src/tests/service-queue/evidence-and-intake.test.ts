import { describe, expect, it, vi } from 'vitest'
import {
	MIN_MS_PER_HAND,
	chatWindow,
	conflictSides,
	explainFlag,
	flagVerdictOf,
	forfeitTimeline,
	handCount,
	markChat,
	placementsAgree,
	reportsAgainstOf,
	reportsFiledOf,
	splitBans,
	withFlags,
} from '../../features/service-queue/evidence/build.js'
import { createIntegrityIntake } from '../../features/service-queue/integrity-intake.js'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const at = (s: number) => new Date(NOW.getTime() + s * 1000)

describe('chat evidence', () => {
	const line = (playerId: string, s: number, message = 'm') => ({
		playerId,
		displayName: playerId,
		message,
		sentAt: at(s),
		flagged: false,
	})

	it("orders lines by time and marks the subject's", () => {
		const marked = markChat([line('b', 2), line('a', 1)], 'a')
		expect(marked.map((l) => [l.playerId, l.bySubject])).toEqual([
			['a', true],
			['b', false],
		])
		expect(markChat([line('a', 1)], null)[0].bySubject).toBe(false)
	})

	it('takes a window either side of a line, clipped at the ends', () => {
		const lines = [0, 1, 2, 3, 4, 5].map((s) => line('a', s))
		expect(chatWindow(lines, 3, 1).map((l) => l.sentAt)).toEqual([at(2), at(3), at(4)])
		expect(chatWindow(lines, 0, 2)).toHaveLength(3)
		expect(chatWindow(lines, -1, 2)).toEqual([])
	})

	it('marks the reported lines the chat log flagged', () => {
		const lines = [line('a', 1, 'hi'), line('b', 2, 'slur'), line('a', 3, 'slur')]
		expect(withFlags(lines, [{ playerId: 'b', message: 'slur' }]).map((l) => l.flagged)).toEqual([false, true, false])
	})

	it("reads a flag's verdict, local matches or a remote band", () => {
		expect(flagVerdictOf(['word', { term: 'other' }])).toEqual({ source: 'local', matches: ['word', 'other'] })
		expect(flagVerdictOf({ band: 'high' })).toEqual({ source: 'remote', band: 'high' })
		expect(flagVerdictOf(null)).toEqual({ source: 'remote', band: 'unknown' })
	})
})

describe('the subject card', () => {
	it('sums reports against a player', () => {
		const rows = [
			{ id: 1, type: 'cheating', status: 'open', reporterId: 'r1', createdAt: at(1) },
			{ id: 2, type: 'cheating', status: 'resolved', reporterId: 'r1', createdAt: at(2) },
			{ id: 3, type: 'chat_abuse', status: 'open', reporterId: 'r2', createdAt: at(3) },
		]
		const summary = reportsAgainstOf(rows)
		expect(summary).toMatchObject({ total: 3, open: 2, distinctReporters: 2, byType: { cheating: 2, chat_abuse: 1 } })
		expect(summary.recent.map((r) => r.id)).toEqual([3, 2, 1])
	})

	it('counts the reports a player filed that led to a sanction', () => {
		expect(
			reportsFiledOf([{ resolutionAction: 'warn' }, { resolutionAction: 'dismiss' }, { resolutionAction: null }, { resolutionAction: 'queue_ban' }]),
		).toEqual({ total: 4, actioned: 2 })
	})

	it('splits bans into active and prior', () => {
		const active = { id: 'a', liftedAt: null, expiresAt: null }
		const expired = { id: 'e', liftedAt: null, expiresAt: at(-1) }
		const lifted = { id: 'l', liftedAt: at(-5), expiresAt: at(100) }
		const running = { id: 'r', liftedAt: null, expiresAt: at(100) }
		const { active: now, prior } = splitBans([active, expired, lifted, running], NOW)
		expect(now.map((b) => b.id)).toEqual(['a', 'r'])
		expect(prior.map((b) => b.id)).toEqual(['e', 'l'])
	})
})

describe('results', () => {
	const ab = [
		{ playerId: 'a', place: 1 },
		{ playerId: 'b', place: 2 },
	]
	const ba = [
		{ playerId: 'a', place: 2 },
		{ playerId: 'b', place: 1 },
	]

	it('compares results by place per player', () => {
		expect(placementsAgree(ab, [...ab].reverse())).toBe(true)
		expect(placementsAgree(ab, ba)).toBe(false)
		expect(placementsAgree([], [])).toBe(false)
		expect(placementsAgree(ab, 'junk')).toBe(false)
	})

	it("shows each side of a conflict against the recorded result", () => {
		const sides = conflictSides(
			{ firstReporterId: 'a', firstPlacements: ab, conflictingReporterId: 'b', conflictingPlacements: ba },
			ab,
		)
		expect(sides.map((s) => [s.role, s.playerId, s.agreesWithResult])).toEqual([
			['first_reporter', 'a', true],
			['conflicting_reporter', 'b', false],
		])
	})
})

describe('anti-cheat explanations', () => {
	it('counts the scored hands in a log, stored tuples or objects', () => {
		expect(handCount([{ opcode: 'hand_result' }, { opcode: 'shop' }, { opcode: 'hand_result' }, null])).toBe(2)
		expect(handCount([[1, 'start', {}], [2, 'hand_result', [100]], [3, 'hand_result', [200]]])).toBe(2)
		expect(handCount(undefined)).toBe(0)
	})

	it('explains an elapsed-time flag with its numbers', () => {
		const flag = explainFlag('elapsed_time_gate', 10, 12_000)
		expect(flag).toMatchObject({ reason: 'elapsed_time_gate', hands: 10, elapsedMs: 12_000, minimumMs: 10 * MIN_MS_PER_HAND })
		expect(flag.text).toContain('10 scored hands need at least 30s')
	})

	it('explains a ranked log that could not be checked', () => {
		const flag = explainFlag('unverified_log', 0, 0)
		expect(flag.reason).toBe('unverified_log')
		expect(flag.text).toContain('season best')
	})

	it('explains a hash mismatch, and anything else as-is', () => {
		expect(explainFlag('hash_mismatch', 0, 0).reason).toBe('hash_mismatch')
		expect(explainFlag('hash_mismatch', 0, 0).text).toContain('shown as incomplete')
		expect(explainFlag(null, 0, 0)).toEqual({ reason: 'unknown', text: 'Flag reason: none recorded' })
	})
})

describe('forfeit timelines', () => {
	it('orders what is known of the game', () => {
		expect(
			forfeitTimeline({ startedAt: at(0), forfeitedAt: at(10), reconnectedAt: at(40), endedAt: at(30) }).map((e) => e.event),
		).toEqual(['started', 'forfeited', 'ended', 'reconnected'])
		expect(forfeitTimeline({ startedAt: null, forfeitedAt: at(10), reconnectedAt: at(40), endedAt: null })).toHaveLength(2)
	})
})

describe('the integrity intake', () => {
	function intake(ranked: { queued: boolean; inGame: boolean } | null, _unused: number) {
		const deps = {
			rankedContext: vi.fn(async () => ranked),
			enqueue: vi.fn(async () => null),
			now: () => NOW,
		}
		return { deps, intake: createIntegrityIntake(deps) }
	}

	it('raises a ranked failure at once, keyed by player and day', async () => {
		const { deps, intake: i } = intake({ queued: true, inGame: false }, 1)
		await i.noteFailure('p1', 'n1', 'hash_mismatch' as never)
		expect(deps.rankedContext).toHaveBeenCalledWith('n1')
		expect(deps.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				itemType: 'integrity',
				sourceId: 'p1:2026-10-21',
				subjectPlayerId: 'p1',
				context: { lobbyKind: 'ranked', integrityTrigger: 'ranked' },
			}),
		)
	})

	it('raises nothing for a failure outside ranked play', async () => {
		const idle = intake({ queued: false, inGame: false }, 9)
		await idle.intake.noteFailure('p1', 'n1', 'refused' as never)
		expect(idle.deps.enqueue).not.toHaveBeenCalled()

		const unknown = intake(null, 9)
		await unknown.intake.noteFailure('p1', 'n1', 'refused' as never)
		expect(unknown.deps.enqueue).not.toHaveBeenCalled()
	})
})
