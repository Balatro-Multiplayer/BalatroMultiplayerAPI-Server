// The service queue's pure rules: the role table, request bodies, claims,
// durations, priority, the integrity-flag decision, retention, source ids,
// source transitions, targets and overturn plans.
import { describe, expect, it } from 'vitest'
import { CLAIM_TTL_MS, activeClaimant, decideClaim, decideRelease, heldByOther } from '../../features/service-queue/claim.js'
import { banTypeOf, parseCommand, presetOf } from '../../features/service-queue/command.js'
import { expiresAtOf } from '../../features/service-queue/durations.js'
import {
	decideIntegrityFlag,
	utcDayStart,
} from '../../features/service-queue/integrity-flag.js'
import { planContestOverturn, planOverturn, ratedPlacements, samePlaces } from '../../features/service-queue/overturn.js'
import { allowedActionsFor, mayIssueBan, mayLiftBan, permissionFor } from '../../features/service-queue/permissions.js'
import { BASE_PRIORITY, priorityOf } from '../../features/service-queue/priority.js'
import {
	reportedLobbyPurgeable,
} from '../../features/service-queue/purge.js'
import { httpOf } from '../../features/service-queue/refusals.js'
import { pickTarget, targetsOf } from '../../features/service-queue/targets.js'
import {
	closes,
	sourceStatusFor,
} from '../../features/service-queue/transitions.js'
import {
	actorOf,
	contextOf,
	playerIdOfActor,
	roleOf,
} from '../../features/service-queue/types.js'
import { EVIDENCE_KEEP_MS } from '../../shared/retention-periods.js'
import {
	antiCheatSourceId,
	integritySourceId,
	numericSourceId,
	parseAntiCheatSourceId,
	parseIntegritySourceId,
} from '../../shared/service-queue/source-ids.js'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const BAN_ID = '00000000-0000-4000-8000-000000000001'

describe('the role table', () => {
	const openReport = { itemType: 'report' as const, status: 'open' as const }

	it('lets moderators dismiss, resolve, warn, mute and queue-ban with every preset', () => {
		for (const action of [
			'dismiss',
			'resolve',
			'warn',
			'chat_mute',
			'queue_ban',
		] as const)
			expect(permissionFor(action, openReport, 'moderator').ok).toBe(true)
		for (const preset of ['24h', '7d', '30d', 'permanent'] as const)
			for (const action of ['chat_mute', 'queue_ban'] as const)
				expect(
					permissionFor(action, openReport, 'moderator', preset).ok,
					`${action} ${preset}`,
				).toBe(true)
	})

	it('lets moderators set a result and void a match where the item type allows it', () => {
		const conflict = {
			itemType: 'match_conflict' as const,
			status: 'open' as const,
		}
		for (const action of ['void', 'overturn'] as const) {
			expect(permissionFor(action, conflict, 'moderator').ok).toBe(true)
			expect(permissionFor(action, openReport, 'moderator')).toEqual({
				ok: false,
				refusal: 'not_for_type',
			})
		}
		expect(
			allowedActionsFor(conflict, 'moderator').map((a) => a.action),
		).toEqual(expect.arrayContaining(['void', 'overturn']))
	})

	it('lets a moderator give a username ban', () => {
		expect(permissionFor('username_ban', openReport, 'moderator').ok).toBe(true)
		expect(parseCommand('username_ban', { reason: 'slur' })).toMatchObject({
			ok: true,
			value: { reason: 'slur' },
		})
	})

	it('keeps account bans to admins', () => {
		expect(permissionFor('account_ban', openReport, 'moderator')).toEqual({
			ok: false,
			refusal: 'forbidden',
		})
		expect(
			permissionFor('account_ban', openReport, 'admin', 'permanent').ok,
		).toBe(true)
		expect(
			permissionFor('queue_ban', openReport, 'admin', 'permanent').ok,
		).toBe(true)
	})

	it('keeps lifting a punishment to admins', () => {
		expect(permissionFor('unban', openReport, 'moderator')).toEqual({
			ok: false,
			refusal: 'forbidden',
		})
		expect(permissionFor('unban', openReport, 'admin').ok).toBe(true)
		expect(
			allowedActionsFor(openReport, 'moderator').map((a) => a.action),
		).not.toContain('unban')
		expect(
			allowedActionsFor(openReport, 'admin').map((a) => a.action),
		).toContain('unban')
	})

	it('refuses an action the type does not take, and one for the wrong status', () => {
		expect(permissionFor('void', openReport, 'admin')).toEqual({ ok: false, refusal: 'not_for_type' })
		expect(permissionFor('chat_mute', { itemType: 'anti_cheat', status: 'open' }, 'admin')).toEqual({
			ok: false,
			refusal: 'not_for_type',
		})
		expect(permissionFor('chat_mute', openReport, 'admin', '7d' as never).ok).toBe(true)
		expect(permissionFor('resolve', { itemType: 'report', status: 'resolved' }, 'admin')).toEqual({
			ok: false,
			refusal: 'wrong_status',
		})
		expect(permissionFor('reopen', openReport, 'admin')).toEqual({ ok: false, refusal: 'wrong_status' })
	})

	it('a preset the action does not have is not for it', () => {
		expect(permissionFor('account_ban', openReport, 'admin', '24h')).toEqual({
			ok: false,
			refusal: 'not_for_type',
		})
	})

	it("sends each role's actions with the presets narrowed to it", () => {
		const forMod = allowedActionsFor(openReport, 'moderator')
		expect(forMod.map((a) => a.action)).toEqual([
			'dismiss',
			'resolve',
			'warn',
			'chat_mute',
			'queue_ban',
			'username_ban',
			'note',
		])
		expect(forMod.find((a) => a.action === 'queue_ban')).toEqual({
			action: 'queue_ban',
			presets: ['24h', '7d', '30d', 'permanent'],
			targeted: true,
			destructive: true,
		})
		expect(forMod.find((a) => a.action === 'chat_mute')?.presets).toEqual([
			'24h',
			'7d',
			'30d',
			'permanent',
		])
		const forAdmin = allowedActionsFor(openReport, 'admin')
		expect(forAdmin.find((a) => a.action === 'account_ban')?.presets).toEqual(['7d', '30d', 'permanent'])
		expect(allowedActionsFor({ itemType: 'forfeit_reconciliation', status: 'open' }, 'moderator').map((a) => a.action)).toEqual(
			['dismiss', 'resolve', 'void', 'note'],
		)
		expect(allowedActionsFor({ itemType: 'integrity', status: 'resolved' }, 'admin').map((a) => a.action)).toEqual([
			'reopen',
			'unban',
			'note',
		])
		expect(
			allowedActionsFor(
				{ itemType: 'forfeit_reconciliation', status: 'open' },
				'moderator',
			).map((a) => a.action),
		).toEqual(['dismiss', 'resolve', 'void', 'note'])
		expect(
			allowedActionsFor(
				{ itemType: 'integrity', status: 'resolved' },
				'admin',
			).map((a) => a.action),
		).toEqual(['reopen', 'unban', 'note'])
	})

	it('every allowed action passes the same check the dispatcher makes', () => {
		for (const itemType of ['report', 'flagged_chat', 'match_conflict', 'forfeit_reconciliation', 'anti_cheat', 'integrity'] as const)
			for (const status of ['open', 'resolved'] as const)
				for (const role of ['moderator', 'admin'] as const)
					for (const allowed of allowedActionsFor({ itemType, status }, role)) {
						expect(permissionFor(allowed.action, { itemType, status }, role).ok).toBe(true)
						for (const preset of allowed.presets ?? [])
							expect(permissionFor(allowed.action, { itemType, status }, role, preset).ok).toBe(true)
					}
	})

	it('lets only admins lift a ban of any kind', () => {
		for (const kind of ['chat', 'queue', 'account'] as const) {
			expect(mayLiftBan('moderator', kind)).toBe(false)
			expect(mayLiftBan('admin', kind)).toBe(true)
		}
	})
})

describe('request bodies', () => {
	it('reads an optional note, falling back to the old resolutionNotes', () => {
		expect(parseCommand('dismiss', { reason: 'r' })).toEqual({ ok: true, value: { action: 'dismiss', reason: 'r', note: null, dismissLabel: null } })
		expect(parseCommand('resolve', { reason: 'r', note: ' ok ' })).toEqual({ ok: true, value: { action: 'resolve', reason: 'r', note: 'ok' } })
		expect(parseCommand('resolve', { reason: 'r', resolutionNotes: 'old' })).toEqual({ ok: true, value: { action: 'resolve', reason: 'r', note: 'old' } })
		expect(parseCommand('resolve', { reason: 'r', note: 5 })).toMatchObject({ ok: false, refusal: { field: 'note' } })
		expect(parseCommand('resolve', { reason: 'r', note: 'x'.repeat(2001) })).toMatchObject({ ok: false, refusal: { field: 'note' } })
	})

	it('requires the text of a note and a warning', () => {
		expect(parseCommand('note', {})).toMatchObject({ ok: false, refusal: { field: 'note' } })
		expect(parseCommand('warn', { reason: 'r' })).toMatchObject({ ok: false, refusal: { field: 'message' } })
		expect(parseCommand('warn', { reason: 'r', message: 'x'.repeat(501) })).toMatchObject({ ok: false, refusal: { field: 'message' } })
		expect(parseCommand('warn', { reason: 'r', message: 'stop', targetPlayerId: 'p2' })).toEqual({
			ok: true,
			value: { action: 'warn', reason: 'r', targetPlayerId: 'p2', message: 'stop', note: null, ladder: null, deviationReason: null },
		})
	})

	it("checks each sanction's presets", () => {
		expect(parseCommand('chat_mute', { reason: 'r', duration: '24h' })).toMatchObject({
			ok: true,
			value: { duration: '24h', reason: 'r' },
		})
		expect(parseCommand('queue_ban', { reason: 'r', duration: '24h' })).toMatchObject({
			ok: true,
			value: { duration: '24h' },
		})
		expect(parseCommand('account_ban', { reason: 'r', duration: 'forever' })).toMatchObject({
			ok: false,
			refusal: { field: 'duration' },
		})
		const ban = parseCommand('queue_ban', {
			duration: '7d',
			reason: 'griefing',
		})
		expect(ban.ok && presetOf(ban.value)).toBe('7d')
		expect(ban.ok && ban.value.action === 'queue_ban' && banTypeOf(ban.value)).toBe('queue')
	})

	it('requires the reporter an overturn keeps and the ban an unban lifts', () => {
		expect(parseCommand('overturn', { reason: 'r' })).toMatchObject({ ok: false, refusal: { field: 'toReportOf' } })
		expect(parseCommand('overturn', { reason: 'r', toReportOf: 'p2' })).toMatchObject({ ok: true, value: { toReportOf: 'p2' } })
		expect(parseCommand('unban', { reason: 'r', banId: 'nope' })).toMatchObject({ ok: false, refusal: { field: 'banId' } })
		expect(parseCommand('unban', { reason: 'r', banId: BAN_ID })).toMatchObject({ ok: true, value: { banId: BAN_ID } })
	})
})

describe('claims', () => {
	const until = new Date(NOW.getTime() + 60_000)

	it('a claim is live until it expires', () => {
		expect(activeClaimant({ claimedBy: 'moderator:m', claimedUntil: until }, NOW)).toBe('moderator:m')
		expect(activeClaimant({ claimedBy: 'moderator:m', claimedUntil: NOW }, NOW)).toBeNull()
		expect(activeClaimant({ claimedBy: null, claimedUntil: null }, NOW)).toBeNull()
	})

	it('is held by the player, under either role', () => {
		expect(heldByOther({ claimedBy: 'moderator:m', claimedUntil: until }, 'm', NOW)).toBeNull()
		expect(heldByOther({ claimedBy: 'admin:m', claimedUntil: until }, 'm', NOW)).toBeNull()
		expect(heldByOther({ claimedBy: 'moderator:m', claimedUntil: until }, 'x', NOW)).toBe('moderator:m')
	})

	it('claims for the TTL, refreshes one\'s own, and refuses a held or closed item', () => {
		const open = { status: 'open', claimedBy: null, claimedUntil: null }
		expect(decideClaim(open, 'm', NOW)).toEqual({ kind: 'claim', until: new Date(NOW.getTime() + CLAIM_TTL_MS) })
		expect(decideClaim({ ...open, claimedBy: 'moderator:m', claimedUntil: until }, 'm', NOW).kind).toBe('claim')
		expect(decideClaim({ ...open, claimedBy: 'moderator:o', claimedUntil: until }, 'm', NOW)).toEqual({
			kind: 'held',
			claimedBy: 'moderator:o',
			claimedUntil: until,
		})
		expect(decideClaim({ ...open, claimedBy: 'moderator:o', claimedUntil: NOW }, 'm', NOW).kind).toBe('claim')
		expect(decideClaim({ ...open, status: 'resolved' }, 'm', NOW)).toEqual({ kind: 'closed' })
	})

	it("releases one's own, or anyone's when forced", () => {
		const held = { claimedBy: 'moderator:o', claimedUntil: until }
		expect(decideRelease(held, 'o', false, NOW)).toEqual({ kind: 'release' })
		expect(decideRelease(held, 'm', false, NOW)).toEqual({ kind: 'held', claimedBy: 'moderator:o' })
		expect(decideRelease(held, 'm', true, NOW)).toEqual({ kind: 'release' })
		expect(decideRelease({ claimedBy: null, claimedUntil: null }, 'm', false, NOW)).toEqual({ kind: 'unclaimed' })
	})
})

describe('durations', () => {
	it('ends a preset after its length, never for permanent', () => {
		expect(expiresAtOf('24h', NOW)).toEqual(new Date(NOW.getTime() + DAY))
		expect(expiresAtOf('7d', NOW)).toEqual(new Date(NOW.getTime() + 7 * DAY))
		expect(expiresAtOf('30d', NOW)).toEqual(new Date(NOW.getTime() + 30 * DAY))
		expect(expiresAtOf('permanent', NOW)).toBeNull()
	})
})

describe('priority', () => {
	const base = { lobbyKind: undefined, openItemsForSubject: 1, distinctReporters: 1, priorSanctions: 0 }

	it('orders by type: anti-cheat and integrity, then reports, then chat', () => {
		const of = (itemType: keyof typeof BASE_PRIORITY) => priorityOf({ ...base, itemType })
		expect(of('anti_cheat')).toBe(of('integrity'))
		expect(of('anti_cheat')).toBeGreaterThan(of('report'))
		expect(of('report')).toBeGreaterThan(of('flagged_chat'))
	})

	it('rises with open items, distinct reporters, ranked games and prior sanctions; private games sit lower', () => {
		const report = { ...base, itemType: 'report' as const }
		const plain = priorityOf(report)
		expect(priorityOf({ ...report, openItemsForSubject: 3 })).toBe(plain + 10)
		expect(priorityOf({ ...report, distinctReporters: 3 })).toBe(plain + 16)
		expect(priorityOf({ ...report, priorSanctions: 2 })).toBe(plain + 20)
		expect(priorityOf({ ...report, lobbyKind: 'ranked' })).toBe(plain + 15)
		expect(priorityOf({ ...report, lobbyKind: 'private' })).toBe(plain - 15)
	})

	it('caps each bonus, counts reporters for reports only, and never goes negative', () => {
		const report = { ...base, itemType: 'report' as const }
		expect(priorityOf({ ...report, openItemsForSubject: 100 })).toBe(priorityOf({ ...report, openItemsForSubject: 5 }))
		expect(priorityOf({ ...report, distinctReporters: 100 })).toBe(priorityOf({ ...report, distinctReporters: 4 }))
		expect(priorityOf({ ...report, priorSanctions: 100 })).toBe(priorityOf({ ...report, priorSanctions: 3 }))
		expect(priorityOf({ ...base, itemType: 'anti_cheat', distinctReporters: 9 })).toBe(BASE_PRIORITY.anti_cheat)
		expect(priorityOf({ ...base, itemType: 'flagged_chat', lobbyKind: 'private' })).toBeGreaterThanOrEqual(0)
	})
})

describe('the integrity flag', () => {
	it('raises a failure while ranked-queued or in a ranked game', () => {
		expect(decideIntegrityFlag({ ranked: { queued: true, inGame: false } })).toEqual({
			kind: 'raise',
			trigger: 'ranked',
		})
		expect(decideIntegrityFlag({ ranked: { queued: false, inGame: true } }).kind).toBe('raise')
	})

	it('raises nothing for a failure outside ranked play, however often it repeats', () => {
		expect(decideIntegrityFlag({ ranked: { queued: false, inGame: false } })).toEqual({ kind: 'none' })
		expect(decideIntegrityFlag({ ranked: null })).toEqual({ kind: 'none' })
	})

	it('keys one item per player per UTC day', () => {
		expect(integritySourceId('p1', new Date('2026-10-21T23:59:59Z'))).toBe('p1:2026-10-21')
		expect(utcDayStart(new Date('2026-10-21T23:59:59Z'))).toEqual(new Date('2026-10-21T00:00:00Z'))
	})
})

describe('retention', () => {
	it("keeps a reported lobby's chat while a report is open and for 180 days after the last resolution (the evidence rule)", () => {
		expect(EVIDENCE_KEEP_MS).toBe(180 * DAY)
		const withinEvidenceLimit = new Date(NOW.getTime() - 100 * DAY)
		expect(
			reportedLobbyPurgeable({ openReports: 0, lastResolvedAt: withinEvidenceLimit, latestExpiresAt: new Date(NOW.getTime() - DAY) }, NOW),
		).toBe(false)
		const expired = new Date(NOW.getTime() - DAY)
		const longAgo = new Date(NOW.getTime() - EVIDENCE_KEEP_MS - 1)
		const recently = new Date(NOW.getTime() - DAY)
		expect(reportedLobbyPurgeable({ openReports: 1, lastResolvedAt: longAgo, latestExpiresAt: expired }, NOW)).toBe(false)
		expect(reportedLobbyPurgeable({ openReports: 0, lastResolvedAt: recently, latestExpiresAt: expired }, NOW)).toBe(false)
		expect(reportedLobbyPurgeable({ openReports: 0, lastResolvedAt: longAgo, latestExpiresAt: expired }, NOW)).toBe(true)
		expect(reportedLobbyPurgeable({ openReports: 0, lastResolvedAt: null, latestExpiresAt: expired }, NOW)).toBe(true)
		expect(
			reportedLobbyPurgeable({ openReports: 0, lastResolvedAt: longAgo, latestExpiresAt: new Date(NOW.getTime() + 1) }, NOW),
		).toBe(false)
	})
})

describe('source ids', () => {
	it("keys an anti-cheat item by run and player, and reads it back", () => {
		const runId = '11111111-1111-4111-8111-111111111111'
		const playerId = '22222222-2222-4222-8222-222222222222'
		expect(parseAntiCheatSourceId(antiCheatSourceId(runId, playerId))).toEqual({ runId, playerId })
		expect(parseAntiCheatSourceId(runId)).toBeNull()
		expect(parseAntiCheatSourceId(':x')).toBeNull()
		expect(parseAntiCheatSourceId('x:')).toBeNull()
	})

	it('reads an integrity key by its last colon', () => {
		expect(parseIntegritySourceId('steam:123:2026-10-21')).toEqual({ playerId: 'steam:123', day: '2026-10-21' })
		expect(parseIntegritySourceId('p1:yesterday')).toBeNull()
		expect(parseIntegritySourceId('2026-10-21')).toBeNull()
	})

	it('reads only whole-number ids as numeric', () => {
		expect(numericSourceId('42')).toBe(42)
		expect(numericSourceId('4a')).toBeNull()
		expect(numericSourceId('')).toBeNull()
	})
})

describe('source transitions', () => {
	it('moves a report or conflict to resolved on any closing action and back on reopen', () => {
		for (const action of ['dismiss', 'resolve', 'warn', 'chat_mute', 'queue_ban', 'account_ban'] as const)
			expect(sourceStatusFor('report', action)).toBe('resolved')
		expect(sourceStatusFor('match_conflict', 'overturn')).toBe('resolved')
		expect(sourceStatusFor('report', 'reopen')).toBe('open')
		expect(sourceStatusFor('report', 'note')).toBeNull()
		expect(sourceStatusFor('report', 'unban')).toBeNull()
	})

	it('voids or dismisses a forfeit flag', () => {
		expect(sourceStatusFor('forfeit_reconciliation', 'void')).toBe('voided')
		expect(sourceStatusFor('forfeit_reconciliation', 'dismiss')).toBe('dismissed')
		expect(sourceStatusFor('forfeit_reconciliation', 'resolve')).toBe('dismissed')
		expect(sourceStatusFor('forfeit_reconciliation', 'reopen')).toBe('open')
	})

	it('leaves the types with no source status alone', () => {
		for (const itemType of ['flagged_chat', 'anti_cheat', 'integrity'] as const)
			expect(sourceStatusFor(itemType, 'resolve')).toBeNull()
		expect(closes('note')).toBe(false)
		expect(closes('void')).toBe(true)
	})
})

describe('targets', () => {
	it("aims a report's actions at the reported player or the reporter", () => {
		const targets = targetsOf({
			itemType: 'report',
			subjectPlayerId: 'bad',
			report: { reporterId: 'rep', reportedId: 'bad' },
		})
		expect(pickTarget(targets, null)).toEqual({ ok: true, target: { role: 'subject', playerId: 'bad' } })
		expect(pickTarget(targets, 'rep')).toEqual({ ok: true, target: { role: 'reporter', playerId: 'rep' } })
		expect(pickTarget(targets, 'someone')).toEqual({ ok: false, refusal: 'invalid_target' })
	})

	it("needs a conflict's target named, and an item with no subject has none", () => {
		const targets = targetsOf({
			itemType: 'match_conflict',
			subjectPlayerId: 'b',
			conflict: { firstReporterId: 'a', conflictingReporterId: 'b' },
		})
		expect(pickTarget(targets, null)).toEqual({ ok: false, refusal: 'no_subject' })
		expect(pickTarget(targets, 'b')).toEqual({ ok: true, target: { role: 'conflicting_reporter', playerId: 'b' } })
		expect(pickTarget(targetsOf({ itemType: 'anti_cheat', subjectPlayerId: null }), null)).toEqual({
			ok: false,
			refusal: 'no_subject',
		})
	})
})

describe('overturn plans', () => {
	const conflict = {
		firstReporterId: 'a',
		firstPlacements: [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 2 },
		],
		conflictingReporterId: 'b',
		conflictingPlacements: [
			{ playerId: 'a', place: 2 },
			{ playerId: 'b', place: 1 },
		],
	}

	it("makes the conflicting report the result, sorted by place", () => {
		expect(planOverturn(conflict, 'b')).toEqual({
			ok: true,
			placements: [
				{ playerId: 'b', place: 1 },
				{ playerId: 'a', place: 2 },
			],
		})
	})

	it('refuses the first report (already the result), a stranger and a malformed report', () => {
		expect(planOverturn(conflict, 'a')).toEqual({ ok: false, refusal: 'unchanged' })
		expect(planOverturn(conflict, 'c')).toEqual({ ok: false, refusal: 'invalid_target' })
		expect(planOverturn({ ...conflict, conflictingPlacements: [{ playerId: 'b', place: 0 }, { playerId: 'a', place: 1 }] }, 'b')).toEqual({
			ok: false,
			refusal: 'source_missing',
		})
	})

	it('rates every unflagged player of a ranked game, nobody otherwise', () => {
		const places = [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 2 },
		]
		expect(ratedPlacements(places, new Set(['b']), true)).toEqual([
			{ playerId: 'a', place: 1, rated: true },
			{ playerId: 'b', place: 2, rated: false },
		])
		expect(ratedPlacements(places, new Set(), false)).toEqual(places)
		expect(samePlaces(places, [...places].reverse())).toBe(true)
		expect(samePlaces(places, [{ playerId: 'a', place: 2 }, { playerId: 'b', place: 1 }])).toBe(false)
	})
})

describe('contest items', () => {
	const open = { itemType: 'contest' as const, status: 'open' as const }

	it('takes dismiss, void, overturn, warn and the three punishments, but not resolve', () => {
		for (const action of ['dismiss', 'warn', 'chat_mute', 'queue_ban'] as const)
			expect(permissionFor(action, open, 'moderator').ok).toBe(true)
		expect(permissionFor('account_ban', open, 'admin', '7d').ok).toBe(true)
		for (const action of ['void', 'overturn'] as const) {
			expect(permissionFor(action, open, 'moderator').ok).toBe(true)
			expect(permissionFor(action, open, 'admin').ok).toBe(true)
		}
		expect(permissionFor('resolve', open, 'admin')).toEqual({ ok: false, refusal: 'not_for_type' })
	})

	it('has no source row to move', () => {
		for (const action of ['dismiss', 'void', 'overturn', 'queue_ban', 'reopen'] as const)
			expect(sourceStatusFor('contest', action)).toBeNull()
	})

	it('ranks beside a result conflict', () => {
		expect(BASE_PRIORITY.contest).toBeGreaterThanOrEqual(BASE_PRIORITY.match_conflict)
		expect(BASE_PRIORITY.contest).toBeLessThan(BASE_PRIORITY.anti_cheat)
	})

	it('aims at the contested player by default, or the contester for a false contest', () => {
		const targets = targetsOf({
			itemType: 'contest',
			subjectPlayerId: 'b',
			contest: { contesterId: 'a', againstId: 'b' },
		})
		expect(pickTarget(targets, null)).toEqual({ ok: true, target: { role: 'subject', playerId: 'b' } })
		expect(pickTarget(targets, 'a')).toEqual({ ok: true, target: { role: 'contester', playerId: 'a' } })
		expect(pickTarget(targets, 'c')).toEqual({ ok: false, refusal: 'invalid_target' })
	})

	it('keeps the contest in the item context', () => {
		const context = { lobbyKind: 'ranked', contest: { contesterId: 'a', againstId: 'b' } }
		expect(contextOf(context)).toEqual(context)
		expect(contextOf({ contest: { contesterId: 'a' } })).toEqual({})
	})

	it('names a winner: first place for them, the rest tied behind', () => {
		expect(planContestOverturn(['a', 'b', 'c'], 'b')).toEqual({
			ok: true,
			placements: [
				{ playerId: 'b', place: 1 },
				{ playerId: 'a', place: 2 },
				{ playerId: 'c', place: 2 },
			],
		})
		expect(planContestOverturn(['a', 'b'], 'z')).toEqual({ ok: false, refusal: 'invalid_target' })
		expect(planContestOverturn([], 'a')).toEqual({ ok: false, refusal: 'source_missing' })
	})
})

describe('vocabulary', () => {
	it('reads roles, actors and contexts', () => {
		expect(roleOf(['moderator', 'admin'])).toBe('admin')
		expect(roleOf(['moderator'])).toBe('moderator')
		expect(roleOf([])).toBeNull()
		expect(actorOf('moderator', 'p')).toBe('moderator:p')
		expect(playerIdOfActor('admin:p')).toBe('p')
		expect(playerIdOfActor(null)).toBeNull()
		expect(contextOf({ lobbyKind: 'private', integrityTrigger: 'x', extra: 1 })).toEqual({ lobbyKind: 'private' })
		expect(contextOf(null)).toEqual({})
	})

	it('answers each refusal with its status and code', () => {
		expect(httpOf({ code: 'forbidden' })).toEqual({
			status: 403,
			body: { error: 'Your role may not take this action', code: 'forbidden' },
		})
		expect(httpOf({ code: 'claimed', claimedBy: 'moderator:m', claimedUntil: null })).toMatchObject({
			status: 409,
			body: { code: 'claimed', claimedBy: 'moderator:m' },
		})
		expect(httpOf({ code: 'nakama_failed', reason: 'down' }).status).toBe(502)
	})
})

describe('bans issued outside the queue (players page)', () => {
	const inDays = (days: number) => new Date(NOW.getTime() + days * DAY)

	it('lets moderators issue chat and queue bans of every preset length', () => {
		for (const type of ['chat', 'queue'] as const) {
			for (const days of [1, 7, 30])
				expect(mayIssueBan('moderator', type, inDays(days), NOW)).toBe(true)
			expect(mayIssueBan('moderator', type, null, NOW)).toBe(true)
		}
		// A client's expiry computed a moment before the request still passes.
		expect(mayIssueBan('moderator', 'queue', new Date(inDays(7).getTime() + 30 * 1000), NOW)).toBe(true)
	})

	it('keeps custom lengths and account bans for admins', () => {
		expect(mayIssueBan('moderator', 'queue', inDays(8), NOW)).toBe(false)
		expect(mayIssueBan('moderator', 'chat', inDays(3), NOW)).toBe(false)
		expect(mayIssueBan('moderator', 'chat', inDays(365), NOW)).toBe(false)
		expect(mayIssueBan('moderator', 'account', inDays(7), NOW)).toBe(false)
		expect(mayIssueBan('moderator', 'account', null, NOW)).toBe(false)
		expect(mayIssueBan('admin', 'account', null, NOW)).toBe(true)
		expect(mayIssueBan('admin', 'queue', inDays(365), NOW)).toBe(true)
		expect(mayIssueBan('admin', 'chat', inDays(3), NOW)).toBe(true)
	})
})
