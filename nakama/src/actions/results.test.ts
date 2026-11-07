import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { type RunRecord, ServerOp } from '../lobby/protocol'
import { activeRunOf } from '../lobby/active'
import { LOG_BURST, action } from '../lobby/relay'
import {
	type Lobby,
	type Outbound,
	type Step,
	disconnect,
	emptyGame,
	join,
	joinRejection,
	labelOf,
	leave,
	newLobby,
	snapshotFor,
	tick,
} from '../lobby/state'
import { type Checkpoint, checkpointOf, resumeFrom } from '../lobby/checkpoint'
import { runWrites } from '../lobby/storage'
import { MAX_LOG_BATCH, MAX_LOG_EVENTS } from './registry'
import { logGapsOf } from '../lobby/log_check'
import { reconcile, settle } from './results'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

let ids = 0
const ctxAt = (now: number) => ({
	now,
	newSeed: () => `SEED000${ids}`,
	newId: () => `RUN${++ids}`,
	random: () => 0,
})

function send(lobby: Lobby, from: string, key: string, params: unknown = {}, now = 1000) {
	return action(lobby, from, { cid: `${key}-${from}`, action: key, to: 'server', params }, ctxAt(now))
}

type Send = Extract<Outbound, { kind: 'send' }>
type Save = Extract<Outbound, { kind: 'saveRun' }>
function rejection(step: Step): string | undefined {
	const r = step.out.filter(
		(o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED,
	)[0]
	return r && (r.payload as { reason: string }).reason
}
function saved(step: Step): Save | undefined {
	return step.out.filter((o): o is Save => o.kind === 'saveRun')[0]
}
function gameEnded(step: Step) {
	const e = step.out.filter(
		(o): o is Send =>
			o.kind === 'send' &&
			o.op === ServerOp.EVENT &&
			(o.payload as { type: string }).type === 'game_ended',
	)[0]
	return e && (e.payload as { data: unknown }).data
}

// A lobby of `players` (the first is host) with a game started.
function started(...players: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerSPDRN',
		maxPlayers: 8,
		creatorId: players[0],
		now: 0,
		graceMs: 10_000,
		resultTimeoutMs: 60_000,
	})
	for (const id of players) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	for (const id of players.slice(1))
		lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
	const step = send(lobby, players[0], 'mpapi_start_game', { stake: 2 })
	expect(rejection(step)).toBeUndefined()
	return step.lobby
}

const places = (...order: string[]) =>
	order.map((playerId, i) => ({ playerId, place: i + 1 }))
const report = (lobby: Lobby, from: string, placements: unknown, now = 2000) =>
	send(lobby, from, 'mpapi_report_result', { placements }, now)

describe('reporting results', () => {
	it('ends the game once every participant agrees', () => {
		let lobby = started('a', 'b')
		const first = report(lobby, 'a', places('b', 'a'))
		expect(saved(first)).toBeUndefined()
		expect(first.lobby.game.started).not.toBeNull()
		const last = report(first.lobby, 'b', places('b', 'a'), 2500)
		const run = saved(last)?.run as RunRecord
		expect(run.status).toBe('agreed')
		expect(run.placements).toEqual(places('a', 'b').map((p) => ({
			playerId: p.playerId,
			place: p.playerId === 'b' ? 1 : 2,
		})))
		expect(run.seed).toMatch(/^SEED/)
		expect(run.stake).toBe(2)
		expect(run.endedAt).toBe(2500)
		expect(gameEnded(last)).toMatchObject({ runId: run.runId, status: 'agreed' })
		lobby = last.lobby
		// The lobby is open again, and can start a second game.
		expect(lobby.game.started).toBeNull()
		expect(JSON.parse(labelOf(lobby)).open).toBe(true)
		expect(joinRejection(lobby, 'z', 'MultiplayerSPDRN')).toBeNull()
		lobby = send(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
		const again = send(lobby, 'a', 'mpapi_start_game', {})
		expect(rejection(again)).toBeUndefined()
		expect(again.lobby.game.started?.runId).not.toBe(run.runId)
	})

	it('refuses malformed or outside reports', () => {
		const lobby = started('a', 'b')
		expect(rejection(report(lobby, 'a', places('a')))).toBe('bad_params')
		expect(rejection(report(lobby, 'a', places('a', 'z')))).toBe('bad_params')
		expect(rejection(report(lobby, 'a', places('a', 'a')))).toBe('bad_params')
		expect(
			rejection(report(lobby, 'a', [{ playerId: 'a', place: 0 }, { playerId: 'b', place: 1 }])),
		).toBe('bad_params')
		expect(
			rejection(
				report(lobby, 'a', [
					{ playerId: 'a', place: 1, performance: 2 },
					{ playerId: 'b', place: 2 },
				]),
			),
		).toBe('bad_params')
		const notStarted = newLobby({
			code: 'X',
			modId: 'm',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: 1,
		})
		const joined = join(notStarted, 'a', 's', info('a')).lobby
		expect(rejection(report(joined, 'a', places('a')))).toBe('not_in_game')
	})

	it('rounds a fractional metric to whole units', () => {
		const lobby = started('a', 'b')
		const fractional = [
			{ playerId: 'a', place: 1, metric: 95281.663 },
			{ playerId: 'b', place: 2, metric: 0.4 },
		]
		const run = saved(report(report(lobby, 'a', fractional).lobby, 'b', fractional, 2500))?.run as RunRecord
		expect(run.placements.map((p) => p.metric)).toEqual([95282, 0])
	})

	it('keeps score text on a placement and drops bad text without refusing the report', () => {
		const lobby = started('a', 'b')
		const good = '20.17609125905568,3'
		const sent = [
			{ playerId: 'a', place: 1, metricText: good },
			{ playerId: 'b', place: 2, metricText: 'nope' },
		]
		const run = saved(report(report(lobby, 'a', sent).lobby, 'b', sent, 2500))?.run as RunRecord
		expect(run.placements.map((p) => p.metricText)).toEqual([good, undefined])
		expect(run.placements.map((p) => p.place)).toEqual([1, 2])
	})

	it('writes score text in its canonical form and drops text over the array limit', () => {
		const lobby = started('a', 'b')
		const tooLong = Array(101).fill('1').join(',')
		const sent = [
			{ playerId: 'a', place: 1, metricText: '20,2' },
			{ playerId: 'b', place: 2, metricText: tooLong },
		]
		const run = saved(report(report(lobby, 'a', sent).lobby, 'b', sent, 2500))?.run as RunRecord
		expect(run.placements.map((p) => p.metricText)).toEqual(['20,2', undefined])
	})

	it('refuses a report from a player who sat the game out', () => {
		// c was away when the game started, so isn't a participant.
		let lobby = newLobby({
			code: 'X',
			modId: 'm',
			maxPlayers: 4,
			creatorId: 'a',
			now: 0,
			graceMs: 10_000,
		})
		for (const id of ['a', 'b', 'c']) lobby = join(lobby, id, `${id}-s`, info(id)).lobby
		lobby = send(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
		lobby = disconnect(lobby, 'c', 'c-s', 500).lobby
		lobby = send(lobby, 'a', 'mpapi_start_game', {}).lobby
		lobby = join(lobby, 'c', 'c-s2', info('c')).lobby
		expect(rejection(report(lobby, 'c', places('a', 'b')))).toBe('not_participant')
		expect(
			rejection(send(lobby, 'c', 'mpapi_log_event', { t: 1, opcode: 'play' })),
		).toBe('not_participant')
	})

	it('lets a player replace their report', () => {
		let lobby = started('a', 'b', 'c')
		lobby = report(lobby, 'a', places('a', 'b', 'c')).lobby
		lobby = report(lobby, 'a', places('b', 'a', 'c')).lobby
		expect(lobby.game.reports.a).toEqual(
			[
				{ playerId: 'a', place: 2 },
				{ playerId: 'b', place: 1 },
				{ playerId: 'c', place: 3 },
			],
		)
		expect(lobby.game.reportOrder).toEqual(['a'])
	})

	it('records the majority when reports differ', () => {
		let lobby = started('a', 'b', 'c')
		lobby = report(lobby, 'a', places('a', 'b', 'c')).lobby
		lobby = report(lobby, 'b', places('b', 'a', 'c')).lobby
		const step = report(lobby, 'c', places('b', 'a', 'c'))
		const run = saved(step)?.run as RunRecord
		expect(run.status).toBe('disputed')
		expect(run.placements.filter((p) => p.place === 1)[0].playerId).toBe('b')
		expect(Object.keys(run.reports).sort()).toEqual(['a', 'b', 'c'])
	})

	it('breaks a tie with the host report, else the first', () => {
		const participants = ['a', 'b'].map((id) => ({ id, displayName: id }))
		const reports = { a: places('a', 'b'), b: places('b', 'a') }
		expect(reconcile(reports, ['b', 'a'], participants, 'a').placements).toEqual(
			reports.a,
		)
		expect(reconcile(reports, ['b', 'a'], participants, 'z').placements).toEqual(
			reports.b,
		)
	})

	it('agrees on places even when metrics differ', () => {
		const participants = ['a', 'b'].map((id) => ({ id, displayName: id }))
		const reports = {
			a: [
				{ playerId: 'a', place: 1, metric: 10 },
				{ playerId: 'b', place: 2 },
			],
			b: [
				{ playerId: 'a', place: 1, metric: 11 },
				{ playerId: 'b', place: 2 },
			],
		}
		expect(reconcile(reports, ['a', 'b'], participants, 'a').status).toBe('agreed')
	})

	it("keeps the host's metrics when a guest's agreeing report came first", () => {
		const participants = ['h', 'g'].map((id) => ({ id, displayName: id }))
		const reports = {
			h: [
				{ playerId: 'h', place: 1, metric: 17056 },
				{ playerId: 'g', place: 2, metric: 27 },
			],
			g: [
				{ playerId: 'h', place: 1, metric: 0 },
				{ playerId: 'g', place: 2, metric: 0 },
			],
		}
		const agreed = reconcile(reports, ['g', 'h'], participants, 'h')
		expect(agreed.status).toBe('agreed')
		expect(agreed.placements).toEqual(reports.h)
		// Without the host in the group: the first report, as before.
		expect(reconcile({ g: reports.g }, ['g'], participants, 'h').placements).toEqual(reports.g)
	})

	it("takes the host's copy within the winning disputed group", () => {
		const participants = ['h', 'a', 'b'].map((id) => ({ id, displayName: id }))
		const reports = {
			a: [
				{ playerId: 'h', place: 1, metric: 0 },
				{ playerId: 'a', place: 2, metric: 0 },
				{ playerId: 'b', place: 3, metric: 0 },
			],
			h: [
				{ playerId: 'h', place: 1, metric: 900 },
				{ playerId: 'a', place: 2, metric: 50 },
				{ playerId: 'b', place: 3, metric: 5 },
			],
			b: [
				{ playerId: 'b', place: 1 },
				{ playerId: 'h', place: 2 },
				{ playerId: 'a', place: 3 },
			],
		}
		const r = reconcile(reports, ['a', 'h', 'b'], participants, 'h')
		expect(r.status).toBe('disputed')
		expect(r.placements).toEqual(reports.h)
	})

	it('stores a partial result when the rest never report', () => {
		let lobby = started('a', 'b', 'c')
		lobby = report(lobby, 'a', places('a', 'b', 'c'), 2000).lobby
		expect(saved(settle(lobby, 2000 + 59_999))).toBeUndefined()
		const step = settle(lobby, 2000 + 60_000)
		expect(saved(step)?.run.status).toBe('partial')
		expect(step.lobby.game.started).toBeNull()
	})

	it('waits for an away participant until the timeout', () => {
		let lobby = started('a', 'b')
		lobby = disconnect(lobby, 'b', 'b-s1', 1500).lobby
		lobby = report(lobby, 'a', places('a', 'b'), 2000).lobby
		expect(lobby.game.started).not.toBeNull()
		expect(saved(settle(lobby, 61_999))).toBeUndefined()
		expect(saved(settle(lobby, 62_000))?.run.status).toBe('partial')
	})

	it('lets the last player standing report, then times out', () => {
		let lobby = started('a', 'b')
		lobby = leave(lobby, 'b').lobby
		const noted = settle(lobby, 3000)
		expect(noted.lobby.game.settleFrom).toBe(3000)
		expect(saved(noted)).toBeUndefined()
		// The remaining player reporting is everyone who's left.
		const step = report(noted.lobby, 'a', places('a', 'b'), 4000)
		expect(saved(step)?.run.status).toBe('partial')
		// Nobody reporting at all: abandoned after the timeout.
		let quiet = started('a', 'b')
		quiet = leave(quiet, 'b').lobby
		quiet = settle(quiet, 3000).lobby
		expect(saved(settle(quiet, 63_000))?.run.status).toBe('abandoned')
	})

	it('starts the result clock when grace expiry leaves one player', () => {
		let lobby = started('a', 'b')
		lobby = disconnect(lobby, 'b', 'b-s1', 1000).lobby
		lobby = tick(lobby, 1000 + 10_000).lobby
		const step = settle(lobby, 12_000)
		expect(step.lobby.game.settleFrom).toBe(12_000)
	})

	it('holds a pending run open past the result clock after a player leaves', () => {
		let lobby = started('a', 'b')
		lobby = leave(lobby, 'a').lobby
		const marked = send(lobby, 'b', 'mpapi_set_result_pending', { pending: true }, 2000)
		expect(rejection(marked)).toBeUndefined()
		lobby = settle(marked.lobby, 3000).lobby
		expect(lobby.game.settleFrom).toBeNull()
		expect(saved(settle(lobby, 3000 + 600_000))).toBeUndefined()
		expect(settle(lobby, 3000 + 600_000).lobby.game.started).not.toBeNull()
	})

	it('does not settle a pending run when the stayer reports, only once it is cleared', () => {
		let lobby = started('a', 'b')
		lobby = leave(lobby, 'a').lobby
		lobby = send(lobby, 'b', 'mpapi_set_result_pending', { pending: true }, 2000).lobby
		const reported = report(lobby, 'b', places('b', 'a'), 4000)
		expect(saved(reported)).toBeUndefined()
		expect(saved(settle(reported.lobby, 4000 + 600_000))).toBeUndefined()
		const cleared = send(reported.lobby, 'b', 'mpapi_set_result_pending', { pending: false }, 5000)
		const run = saved(cleared)?.run as RunRecord
		expect(run.status).toBe('partial')
		// The player who left is still placed, so the rating step rates them.
		expect(run.placements).toEqual([
			{ playerId: 'a', place: 2 },
			{ playerId: 'b', place: 1 },
		])
		expect(cleared.lobby.game.started).toBeNull()
	})

	it('closes a pending run when the last participant is gone', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'b', 'mpapi_set_result_pending', { pending: true }, 2000).lobby
		lobby = leave(lobby, 'a').lobby
		lobby = leave(lobby, 'b').lobby
		expect(saved(settle(lobby, 3000))?.run.status).toBe('abandoned')
	})

	it('only lets a participant of a started game mark a run pending', () => {
		let idle = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: 10_000,
			resultTimeoutMs: 60_000,
		})
		idle = join(idle, 'a', 'a-s1', info('a')).lobby
		expect(rejection(send(idle, 'a', 'mpapi_set_result_pending', { pending: true }))).toBe('not_in_game')
		const lobby = started('a', 'b')
		expect(rejection(send(lobby, 'a', 'mpapi_set_result_pending', { pending: 'yes' }))).toBe('bad_params')
	})

	it('keeps the pending flag through a checkpoint resume and clears it with the run', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_set_result_pending', { pending: true }, 2000).lobby
		const resumed = resumeFrom(checkpointOf(lobby, 5000) as Checkpoint, 9000)
		expect(resumed.game.resultPending).toBe(true)
		lobby = report(lobby, 'a', places('a', 'b')).lobby
		lobby = report(send(lobby, 'a', 'mpapi_set_result_pending', { pending: false }, 3000).lobby, 'b', places('a', 'b'), 3500).lobby
		expect(lobby.game.resultPending).toBeFalsy()
	})

	it('names the player who left as owed the late result of a once-pending run', () => {
		let lobby = started('a', 'b')
		lobby = leave(lobby, 'a').lobby
		lobby = send(lobby, 'b', 'mpapi_set_result_pending', { pending: true }, 2000).lobby
		lobby = report(lobby, 'b', places('b', 'a'), 4000).lobby
		const cleared = send(lobby, 'b', 'mpapi_set_result_pending', { pending: false }, 5000)
		expect(saved(cleared)?.lateResultTo).toEqual(['a'])
	})

	it('names nobody when the run was never pending', () => {
		let lobby = started('a', 'b')
		lobby = leave(lobby, 'a').lobby
		const done = report(lobby, 'b', places('b', 'a'), 4000)
		expect(saved(done)?.lateResultTo).toEqual([])
	})

	it('names nobody when everyone stayed to the end', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'b', 'mpapi_set_result_pending', { pending: true }, 2000).lobby
		lobby = report(lobby, 'b', places('b', 'a'), 4000).lobby
		lobby = report(lobby, 'a', places('b', 'a'), 4100).lobby
		const cleared = send(lobby, 'b', 'mpapi_set_result_pending', { pending: false }, 5000)
		expect(saved(cleared)?.lateResultTo).toEqual([])
	})

	it('hands reports and the run id back in the snapshot', () => {
		let lobby = started('a', 'b')
		lobby = report(lobby, 'a', places('a', 'b')).lobby
		const snap = snapshotFor(lobby, 'b')
		expect(snap.game.reported).toEqual(['a'])
		expect(snap.game.started?.runId).toMatch(/^RUN/)
		expect(snap.game).not.toHaveProperty('logs')
	})
})

function startedMatchmade(...players: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 8,
		creatorId: players[0],
		gameMode: 'ranked:duel',
		rankedMode: 'duel',
		allowedIds: players,
		now: 0,
		graceMs: 10_000,
		resultTimeoutMs: 60_000,
	})
	for (const id of players) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	for (const id of players.slice(1)) lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
	return send(lobby, players[0], 'mpapi_start_game', { stake: 2 }).lobby
}

describe('contest', () => {
	it('records who contested whom and tells everyone', () => {
		const lobby = startedMatchmade('a', 'b')
		const step = send(lobby, 'a', 'mpapi_contest', {}, 2000)
		expect(rejection(step)).toBeUndefined()
		expect(step.lobby.game.contest).toEqual({ by: 'a', against: 'b', at: 2000 })
		const echoed = step.out.filter((o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION)
		expect(echoed.length).toBeGreaterThan(0)
	})

	it('records the Contest for the mirror right away, before the run ends', () => {
		const lobby = startedMatchmade('a', 'b', 'c')
		const step = send(lobby, 'a', 'mpapi_contest', { opponentId: 'c' }, 2000)
		const made = step.out.filter((o) => o.kind === 'contest')
		expect(made).toEqual([
			{
				kind: 'contest',
				runId: lobby.game.started?.runId,
				code: lobby.code,
				by: 'a',
				against: 'c',
				at: 2000,
				lobbyKind: expect.any(String),
			},
		])
		expect(saved(step)).toBeUndefined()
	})

	it('needs the opponent named in a match of more than 2', () => {
		const lobby = startedMatchmade('a', 'b', 'c')
		expect(rejection(send(lobby, 'a', 'mpapi_contest', {}))).toBe('bad_params')
		expect(rejection(send(lobby, 'a', 'mpapi_contest', { opponentId: 'a' }))).toBe('bad_params')
		expect(rejection(send(lobby, 'a', 'mpapi_contest', { opponentId: 'z' }))).toBe('bad_params')
		const step = send(lobby, 'a', 'mpapi_contest', { opponentId: 'c' }, 2000)
		expect(step.lobby.game.contest).toEqual({ by: 'a', against: 'c', at: 2000 })
	})

	it('refuses outside a started matchmade game, from a bystander, or twice', () => {
		expect(rejection(send(started('a', 'b'), 'a', 'mpapi_contest', {}))).toBe('not_matchmade')
		const lobby = startedMatchmade('a', 'b', 'c')
		const first = send(lobby, 'a', 'mpapi_contest', { opponentId: 'b' }, 2000)
		expect(rejection(send(first.lobby, 'c', 'mpapi_contest', { opponentId: 'b' }))).toBe('already_contested')
		let idle = newLobby({ code: 'X', modId: 'm', maxPlayers: 2, creatorId: 'a', gameMode: 'duel', now: 0, graceMs: 1 })
		idle = join(idle, 'a', 'a-s1', info('a')).lobby
		expect(rejection(send(idle, 'a', 'mpapi_contest', {}))).toBe('not_in_game')
		const duel = startedMatchmade('a', 'b')
		const outsider = join(duel, 'z', 'z-s1', info('z')).lobby
		expect(rejection(send(outsider, 'z', 'mpapi_contest', {}))).toBe('not_participant')
	})

	it('stores the run as contested, with its reported result, so nobody is rated', () => {
		let lobby = startedMatchmade('a', 'b')
		lobby = report(lobby, 'a', places('a', 'b'), 1500).lobby
		lobby = send(lobby, 'b', 'mpapi_contest', {}, 2000).lobby
		lobby = leave(lobby, 'b').lobby
		const closed = settle(lobby, 2000 + 60_000)
		const run = saved(closed)?.run as RunRecord
		expect(run.status).toBe('contested')
		expect(run.contest).toEqual({ by: 'b', against: 'a', at: 2000 })
		expect(run.placements).toEqual(places('a', 'b'))
		expect(gameEnded(closed)).toMatchObject({ status: 'contested' })
	})

	it('lets the others of a match of 3 play on, then stores the run as contested', () => {
		let lobby = startedMatchmade('a', 'b', 'c')
		lobby = send(lobby, 'a', 'mpapi_contest', { opponentId: 'b' }, 2000).lobby
		lobby = leave(lobby, 'a').lobby
		// The game stays open for b and c: no save, no GAME_ENDED yet.
		expect(lobby.game.started).not.toBeNull()
		expect(settle(lobby, 3000).out.filter((o) => o.kind === 'saveRun')).toEqual([])
		// b and c can still act and report as usual.
		const first = report(lobby, 'b', places('c', 'b', 'a'), 4000)
		expect(rejection(first)).toBeUndefined()
		expect(saved(first)).toBeUndefined()
		const last = report(first.lobby, 'c', places('c', 'b', 'a'), 4500)
		const run = saved(last)?.run as RunRecord
		expect(run.status).toBe('contested')
		expect(run.contest).toEqual({ by: 'a', against: 'b', at: 2000 })
		expect(run.placements).toHaveLength(3)
		expect(run.placements).toEqual(
			expect.arrayContaining([
				{ playerId: 'c', place: 1 },
				{ playerId: 'b', place: 2 },
				{ playerId: 'a', place: 3 },
			]),
		)
		expect(gameEnded(last)).toMatchObject({ status: 'contested' })
	})

	it('still stores a contested run when nobody reported', () => {
		let lobby = startedMatchmade('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_contest', {}, 2000).lobby
		lobby = leave(lobby, 'a').lobby
		lobby = leave(lobby, 'b').lobby
		const run = saved(settle(lobby, 3000))?.run as RunRecord
		expect(run.status).toBe('contested')
		expect(run.placements).toEqual([])
	})

	it('stays contested when the host restarts or abandons, and a pending-flag clear does not lift it', () => {
		let lobby = startedMatchmade('a', 'b')
		lobby = send(lobby, 'b', 'mpapi_contest', {}, 2000).lobby
		lobby = send(lobby, 'a', 'mpapi_set_result_pending', { pending: false }, 2100).lobby
		expect(lobby.game.contest).toBeDefined()
		const abandoned = send(lobby, 'a', 'mpapi_abandon_game', {}, 3000)
		expect(saved(abandoned)?.run.status).toBe('contested')
	})

	it('settles a contested run although its result is still pending', () => {
		let lobby = startedMatchmade('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_set_result_pending', { pending: true }, 1500).lobby
		lobby = send(lobby, 'a', 'mpapi_contest', {}, 2000).lobby
		lobby = report(lobby, 'a', places('a', 'b'), 2500).lobby
		const last = report(lobby, 'b', places('a', 'b'), 3000)
		const run = saved(last)?.run as RunRecord
		expect(run.status).toBe('contested')
		expect(run.contest).toEqual({ by: 'a', against: 'b', at: 2000 })
		expect(gameEnded(last)).toMatchObject({ status: 'contested' })
	})

	it('keeps the contest through a checkpoint resume', () => {
		let lobby = startedMatchmade('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_contest', {}, 2000).lobby
		const resumed = resumeFrom(checkpointOf(lobby, 5000) as Checkpoint, 9000)
		expect(resumed.game.contest).toEqual({ by: 'a', against: 'b', at: 2000 })
	})
})

describe('abandon and restart', () => {
	it('lets only the host abandon, storing no result', () => {
		const lobby = report(started('a', 'b'), 'a', places('a', 'b')).lobby
		expect(rejection(send(lobby, 'b', 'mpapi_abandon_game'))).toBe('not_host')
		const step = send(lobby, 'a', 'mpapi_abandon_game')
		expect(saved(step)?.run.status).toBe('abandoned')
		expect(saved(step)?.run.placements).toEqual([])
		expect(gameEnded(step)).toMatchObject({ status: 'abandoned' })
		expect(step.lobby.game.started).toBeNull()
	})

	it('restarts on a new seed, storing the old game quietly', () => {
		const lobby = started('a', 'b')
		const before = lobby.game.started
		expect(rejection(send(lobby, 'b', 'mpapi_restart_game'))).toBe('not_host')
		const step = send(lobby, 'a', 'mpapi_restart_game')
		expect(saved(step)?.run).toMatchObject({ runId: before?.runId, status: 'restarted' })
		expect(gameEnded(step)).toBeUndefined()
		const after = step.lobby.game.started
		expect(after?.runId).not.toBe(before?.runId)
		expect(after?.seed).not.toBe(before?.seed)
		expect(after?.stake).toBe(2)
		expect(after?.players.map((p) => p.id)).toEqual(['a', 'b'])
	})

	it('needs a game to restart or abandon', () => {
		let lobby = newLobby({ code: 'X', modId: 'm', maxPlayers: 2, creatorId: 'a', now: 0, graceMs: 1 })
		lobby = join(lobby, 'a', 's', info('a')).lobby
		expect(rejection(send(lobby, 'a', 'mpapi_restart_game'))).toBe('not_in_game')
		expect(rejection(send(lobby, 'a', 'mpapi_abandon_game'))).toBe('not_in_game')
	})
})

describe('start options', () => {
	it('honours a gamemode minimum, within the lobby size', () => {
		let lobby = newLobby({ code: 'X', modId: 'm', maxPlayers: 3, creatorId: 'a', now: 0, graceMs: 1 })
		for (const id of ['a', 'b']) lobby = join(lobby, id, `${id}-s`, info(id)).lobby
		lobby = send(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
		expect(rejection(send(lobby, 'a', 'mpapi_start_game', { minPlayers: 3 }))).toBe(
			'too_few_players',
		)
		// Asking for more than the lobby holds is capped at its size.
		lobby = join(lobby, 'c', 'c-s', info('c')).lobby
		lobby = send(lobby, 'c', 'mpapi_ready', { ready: true }).lobby
		expect(
			rejection(send(lobby, 'a', 'mpapi_start_game', { minPlayers: 50 })),
		).toBeUndefined()
		expect(rejection(send(lobby, 'a', 'mpapi_start_game', { minPlayers: 'x' }))).toBe(
			'bad_params',
		)
	})
})

describe('replay logs', () => {
	const log = (lobby: Lobby, from: string, t: number, now = 1500) =>
		send(lobby, from, 'mpapi_log_event', { t, opcode: 'play', args: [t] }, now)

	it('keeps events per player and passes them on to the others', () => {
		let step = log(started('a', 'b', 'c'), 'a', 1)
		const sent = step.out.filter((o): o is Send => o.kind === 'send')[0]
		expect(sent.to).toEqual(['b', 'c'])
		expect(sent.payload).toMatchObject({
			from: 'server',
			params: { playerId: 'a', t: 1, opcode: 'play', args: [1] },
		})
		step = log(step.lobby, 'a', 2)
		expect(step.lobby.game.logs.a.lines).toEqual(['[1,"play",[1]]', '[2,"play",[2]]'])
	})

	it('stamps the race start on the first recorded event and keeps it', () => {
		const lobby = started('a', 'b')
		expect(lobby.game.started?.raceStartedAt).toBeUndefined()
		let step = log(lobby, 'b', 1, 2000)
		expect(step.lobby.game.started?.raceStartedAt).toBe(2000)
		step = log(step.lobby, 'a', 2, 9000)
		expect(step.lobby.game.started?.raceStartedAt).toBe(2000)
		expect(snapshotFor(step.lobby, 'a', 9500).game.started?.raceStartedAt).toBe(2000)
	})

	it('starts the race again for a restarted game', () => {
		let lobby = log(started('a', 'b'), 'a', 1, 2000).lobby
		lobby = send(lobby, 'a', 'mpapi_restart_game', {}, 3000).lobby
		expect(lobby.game.started?.raceStartedAt).toBeUndefined()
	})

	it('tells a joiner the server time, to measure the race against', () => {
		const lobby = log(started('a', 'b'), 'a', 1, 2000).lobby
		const snap = snapshotFor(lobby, 'b', 61_000)
		expect(snap.serverNow).toBe(61_000)
	})

	it('drops an event sent for a run the server has restarted', () => {
		const lobby = started('a', 'b')
		const runId = lobby.game.started!.runId
		const stale = send(lobby, 'a', 'mpapi_log_event', { t: 9, opcode: 'play', run: 'old-run' })
		expect(rejection(stale)).toBeUndefined()
		expect(stale.lobby.game.logs.a).toBeUndefined()
		expect(stale.out.filter((o) => o.kind === 'send')).toEqual([])
		const current = send(lobby, 'a', 'mpapi_log_event', { t: 9, opcode: 'play', run: runId })
		expect(current.lobby.game.logs.a.lines).toEqual(['[9,"play",null]'])
	})

	it('keeps a late burst of events in arrival order, after the sender was away', () => {
		let lobby = started('a', 'b')
		const runId = lobby.game.started!.runId
		lobby = log(lobby, 'a', 1).lobby
		lobby = disconnect(lobby, 'a', 'a-s', 1600).lobby
		lobby = join(lobby, 'a', 'a-s2', info('a')).lobby
		// Events made while the socket was down arrive together, in order.
		for (const t of [2, 3, 4]) {
			const step = send(lobby, 'a', 'mpapi_log_event', { t, opcode: 'play', args: [t], run: runId }, 1700)
			expect(rejection(step)).toBeUndefined()
			lobby = step.lobby
		}
		expect(lobby.game.logs.a.lines).toEqual([
			'[1,"play",[1]]',
			'[2,"play",[2]]',
			'[3,"play",[3]]',
			'[4,"play",[4]]',
		])
	})

	it('refuses events outside a game, or malformed ones', () => {
		const idle = newLobby({ code: 'X', modId: 'm', maxPlayers: 2, creatorId: 'a', now: 0, graceMs: 1 })
		const joined = join(idle, 'a', 's', info('a')).lobby
		expect(rejection(log(joined, 'a', 1))).toBe('not_in_game')
		expect(
			rejection(send(started('a', 'b'), 'a', 'mpapi_log_event', { t: 'x', opcode: 'play' })),
		).toBe('bad_params')
	})

	it('stops keeping events past the cap, silently', () => {
		const lobby = started('a', 'b')
		const full = {
			...lobby,
			game: {
				...lobby.game,
				logs: {
					a: {
						lines: new Array(MAX_LOG_EVENTS).fill('[0,"x",null]'),
						bytes: 0,
						truncated: false,
					},
				},
			},
		}
		const step = log(full, 'a', 1)
		expect(rejection(step)).toBeUndefined()
		expect(step.out).toEqual([])
		expect(step.lobby.game.logs.a.truncated).toBe(true)
		expect(step.lobby.game.logs.a.lines).toHaveLength(MAX_LOG_EVENTS)
	})

	it('budgets log events apart from other actions', () => {
		let lobby = started('a', 'b')
		for (let i = 0; i < 150; i++) lobby = log(lobby, 'a', i, 1500).lobby
		// 150 log events in the same instant, and 'a' can still act.
		const step = report(lobby, 'a', places('a', 'b'), 1500)
		expect(rejection(step)).toBeUndefined()
	})

	describe('ack on a log action', () => {
		const acks = (step: Step) =>
			step.out.filter(
				(o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION && o.to.includes('a') && o.to.length === 1,
			)

		it('answers the sender of a batch with the request cid, and stores no ack', () => {
			const lobby = started('a', 'b')
			const runId = lobby.game.started!.runId
			const events = [
				{ t: 1, opcode: 'play', run: runId },
				{ t: 2, opcode: 'play', run: runId },
			]
			const step = send(lobby, 'a', 'mpapi_log_events', { events, ack: true })
			expect(step.lobby.game.logs.a.lines).toEqual(['[1,"play",null]', '[2,"play",null]'])
			const reply = acks(step)
			expect(reply).toHaveLength(1)
			expect(reply[0].payload).toEqual({
				cid: 'mpapi_log_events-a',
				action: 'mpapi_log_events',
				from: 'server',
				to: '*',
				params: { ack: true },
			})
		})

		it('answers the sender of a single event, and stores no ack', () => {
			const lobby = started('a', 'b')
			const step = send(lobby, 'a', 'mpapi_log_event', { t: 1, opcode: 'play', ack: true })
			expect(step.lobby.game.logs.a.lines).toEqual(['[1,"play",null]'])
			expect(acks(step)).toHaveLength(1)
			expect(acks(step)[0].payload).toMatchObject({ cid: 'mpapi_log_event-a', params: { ack: true } })
		})

		it('answers even when every event was dropped as another run', () => {
			const lobby = started('a', 'b')
			const step = send(lobby, 'a', 'mpapi_log_events', { events: [{ t: 1, opcode: 'play', run: 'old' }], ack: true })
			expect(acks(step)).toHaveLength(1)
		})

		it('says nothing extra without ack', () => {
			const lobby = started('a', 'b')
			const step = send(lobby, 'a', 'mpapi_log_events', { events: [{ t: 1, opcode: 'play' }] })
			expect(acks(step)).toEqual([])
			expect(acks(send(lobby, 'a', 'mpapi_log_event', { t: 1, opcode: 'play', ack: false }))).toEqual([])
		})

		it('does not ack a refused batch, it rejects it', () => {
			const lobby = started('a', 'b')
			const step = send(lobby, 'a', 'mpapi_log_events', { events: [], ack: true })
			expect(rejection(step)).toBe('bad_params')
			expect(acks(step)).toEqual([])
		})
	})

	describe('numbered events (seq)', () => {
		const numbered = (from: number, count: number, run?: string) =>
			Array.from({ length: count }, (_, i) => ({ t: from + i, opcode: 'play', seq: from + i, run }))
		const batchOf = (lobby: Lobby, events: unknown[]) =>
			send(lobby, 'a', 'mpapi_log_events', { events, ack: true })
		const ackOf = (step: Step) =>
			step.out.filter((o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION && o.to.length === 1 && o.to[0] === 'a')[0]
				?.payload as { params: unknown }

		it('tells the sender the highest number held in the ack', () => {
			const step = batchOf(started('a', 'b'), numbered(1, 3))
			expect(step.lobby.game.logs.a.lines).toHaveLength(3)
			expect(ackOf(step).params).toEqual({ ack: true, got: 3 })
		})

		it('does not keep a batch lost before it, and tells where to start again', () => {
			let lobby = batchOf(started('a', 'b'), numbered(1, 3)).lobby
			// events 4 to 6 never arrived; 7 to 9 did
			const step = batchOf(lobby, numbered(7, 3))
			expect(step.lobby.game.logs.a.lines).toHaveLength(3)
			expect(ackOf(step).params).toEqual({ ack: true, got: 3 })
			expect(step.out.filter((o) => o.kind === 'send' && o.op === ServerOp.ACTION && o.to.length > 1)).toEqual([])
			// the client sends again from 4: the log is whole and in order
			lobby = batchOf(step.lobby, numbered(4, 6)).lobby
			expect(lobby.game.logs.a.lines).toEqual(
				Array.from({ length: 9 }, (_, i) => `[${i + 1},"play",null]`),
			)
			expect(logGapsOf(lobby.game.logs.a)).toBe(0)
		})

		it('keeps a refused batch again when it is sent a second time', () => {
			const lobby = started('a', 'b')
			expect(rejection(send(lobby, 'a', 'mpapi_log_events', { events: [] }))).toBe('bad_params')
			const step = batchOf(lobby, numbered(1, 2))
			expect(step.lobby.game.logs.a.lines).toHaveLength(2)
		})

		it('keeps a copy of a batch it already holds only once', () => {
			const first = batchOf(started('a', 'b'), numbered(1, 4))
			const again = batchOf(first.lobby, numbered(1, 4))
			expect(again.lobby.game.logs.a.lines).toHaveLength(4)
			expect(ackOf(again).params).toEqual({ ack: true, got: 4 })
			// no copy reaches the others
			expect(again.out.filter((o) => o.kind === 'send' && o.to.includes('b'))).toEqual([])
			// a batch that overlaps what it holds keeps only the new events
			const overlap = batchOf(first.lobby, numbered(3, 4))
			expect(overlap.lobby.game.logs.a.lines).toHaveLength(6)
		})

		it('counts the events it saw beyond a gap that is never filled', () => {
			const lobby = batchOf(batchOf(started('a', 'b'), numbered(1, 3)).lobby, numbered(8, 2)).lobby
			expect(lobby.game.logs.a.seq).toBe(3)
			expect(logGapsOf(lobby.game.logs.a)).toBe(6)
		})

		it('keeps the old behaviour for events with no number', () => {
			const step = send(started('a', 'b'), 'a', 'mpapi_log_events', {
				events: [{ t: 1, opcode: 'play' }, { t: 2, opcode: 'play' }],
				ack: true,
			})
			expect(step.lobby.game.logs.a.lines).toHaveLength(2)
			expect(ackOf(step).params).toEqual({ ack: true })
			expect(logGapsOf(step.lobby.game.logs.a)).toBe(0)
		})

		it('tells a rejoining player how many events it holds, so the next ones are kept', () => {
			let lobby = batchOf(started('a', 'b'), numbered(1, 4)).lobby
			expect(snapshotFor(lobby, 'a', 2000).game.logSeq).toBe(4)
			expect(snapshotFor(lobby, 'b', 2000).game.logSeq).toBe(0)
			// a new process rejoins: it starts from the snapshot's count
			lobby = disconnect(lobby, 'a', 'a-s1', 1600).lobby
			lobby = join(lobby, 'a', 'a-s2', info('a')).lobby
			const from = snapshotFor(lobby, 'a', 2000).game.logSeq + 1
			const step = batchOf(lobby, numbered(from, 2))
			expect(step.lobby.game.logs.a.lines).toHaveLength(6)
			expect(ackOf(step).params).toEqual({ ack: true, got: 6 })
			// numbering again from 1 would be skipped as copies
			expect(batchOf(lobby, numbered(1, 2)).lobby.game.logs.a.lines).toHaveLength(4)
		})

		it('numbers a single event the same way', () => {
			const lobby = started('a', 'b')
			const lost = send(lobby, 'a', 'mpapi_log_event', { t: 5, opcode: 'play', seq: 5, ack: true })
			expect(lost.lobby.game.logs.a.lines).toEqual([])
			expect((ackOf(lost).params as { got: number }).got).toBe(0)
			const first = send(lobby, 'a', 'mpapi_log_event', { t: 1, opcode: 'play', seq: 1, ack: true })
			expect(first.lobby.game.logs.a.lines).toHaveLength(1)
			expect((ackOf(first).params as { got: number }).got).toBe(1)
		})
	})

	describe('batches (mpapi_log_events)', () => {
		const batch = (lobby: Lobby, from: string, events: unknown[], now = 1500) =>
			send(lobby, from, 'mpapi_log_events', { events }, now)
		const events = (from: number, count: number, run?: string) =>
			Array.from({ length: count }, (_, i) => ({ t: from + i, opcode: 'play', args: [from + i], run }))

		it('stamps the race start on the first batch and keeps it', () => {
			const lobby = started('a', 'b')
			const runId = lobby.game.started!.runId
			let step = batch(lobby, 'b', events(1, 2, runId), 2000)
			expect(step.lobby.game.started?.raceStartedAt).toBe(2000)
			step = batch(step.lobby, 'a', events(3, 1, runId), 9000)
			expect(step.lobby.game.started?.raceStartedAt).toBe(2000)
		})

		it('keeps the events in order and tells the others once', () => {
			const lobby = started('a', 'b', 'c')
			const runId = lobby.game.started!.runId
			const step = batch(lobby, 'a', events(1, 3, runId))
			expect(step.lobby.game.logs.a.lines).toEqual(['[1,"play",[1]]', '[2,"play",[2]]', '[3,"play",[3]]'])
			const sent = step.out.filter((o): o is Send => o.kind === 'send')
			expect(sent).toHaveLength(1)
			expect(sent[0].to).toEqual(['b', 'c'])
			expect(sent[0].payload).toMatchObject({
				from: 'server',
				action: 'mpapi_log_events',
				params: { playerId: 'a', t: 3, opcode: 'play', count: 3 },
			})
		})

		it('stores a 261-event burst whole, in 6 batches, without a rate refusal', () => {
			let lobby = started('a', 'b')
			const runId = lobby.game.started!.runId
			const all = events(1, 261, runId)
			for (let at = 0; at < all.length; at += MAX_LOG_BATCH) {
				const step = batch(lobby, 'a', all.slice(at, at + MAX_LOG_BATCH))
				expect(rejection(step)).toBeUndefined()
				lobby = step.lobby
			}
			expect(lobby.game.logs.a.lines).toHaveLength(261)
		})

		it('spends one token per event, so a batch is not cheaper than singles', () => {
			let lobby = started('a', 'b')
			// LOG_BURST events at one instant empty the bucket.
			for (let at = 0; at < LOG_BURST; at += MAX_LOG_BATCH) {
				const step = batch(lobby, 'a', events(at, Math.min(MAX_LOG_BATCH, LOG_BURST - at)))
				expect(rejection(step)).toBeUndefined()
				lobby = step.lobby
			}
			expect(rejection(batch(lobby, 'a', events(5000, 1)))).toBe('rate_limited')
			expect(rejection(log(lobby, 'a', 5001, 1500))).toBe('rate_limited')
			// Refills at LOG_RATE_PER_SECOND: 2 seconds buy 40 events.
			expect(rejection(batch(lobby, 'a', events(6000, 40), 3500))).toBeUndefined()
		})

		it('refuses an empty, oversize or malformed batch, keeping none of it', () => {
			const lobby = started('a', 'b')
			expect(rejection(batch(lobby, 'a', []))).toBe('bad_params')
			expect(rejection(batch(lobby, 'a', events(1, MAX_LOG_BATCH + 1)))).toBe('bad_params')
			const mixed = batch(lobby, 'a', [...events(1, 2), { t: 'x', opcode: 'play' }])
			expect(rejection(mixed)).toBe('bad_params')
			expect(mixed.lobby.game.logs.a).toBeUndefined()
			expect(rejection(send(lobby, 'a', 'mpapi_log_events', { events: 'no' }))).toBe('bad_params')
		})

		it('drops events of a restarted run, and ignores a stranger', () => {
			const lobby = started('a', 'b')
			const stale = batch(lobby, 'a', events(1, 2, 'old-run'))
			expect(rejection(stale)).toBeUndefined()
			expect(stale.lobby.game.logs.a).toBeUndefined()
			expect(stale.out.filter((o) => o.kind === 'send')).toEqual([])
			expect(batch(lobby, 'z', events(1, 1)).out).toEqual([])
		})

		it('passes every event on to spectators', () => {
			const lobby = { ...started('a', 'b'), spectators: ['s'] }
			const step = batch(lobby, 'a', events(1, 3))
			const spectated = step.out.filter((o): o is Send => o.kind === 'send' && o.op === ServerOp.SPECTATE_EVENT)
			expect(spectated.map((o) => (o.payload as { t: number }).t)).toEqual([1, 2, 3])
		})
	})

	it('stores the logs with the run', () => {
		let lobby = log(started('a', 'b'), 'a', 1).lobby
		lobby = report(lobby, 'a', places('a', 'b')).lobby
		const step = report(lobby, 'b', places('a', 'b'))
		expect(saved(step)?.logs.a.lines).toEqual(['[1,"play",[1]]'])
		expect(step.lobby.game.logs).toEqual({})
	})
})

describe('active run', () => {
	it('is null when no game is running', () => {
		expect(
			activeRunOf({ ...started('a', 'b'), game: emptyGame() }, 'a', sha256),
		).toBeNull()
	})

	it('gives a participant their own events so far, as {t, opcode, args}', () => {
		const lobby = log2(started('a', 'b'))
		const active = activeRunOf(lobby, 'a', sha256)
		expect(active).toMatchObject({ runId: lobby.game.started?.runId, code: lobby.code, modId: lobby.modId })
		expect(active?.events).toEqual([{ t: 1, opcode: 'play', args: null }])
		expect(activeRunOf(lobby, 'b', sha256)?.events).toEqual([])
	})

	it("names the game's bar for coming back, null for a lobby without one", () => {
		const lobby = log2(started('a', 'b'))
		expect(activeRunOf(lobby, 'a', sha256)?.requiredStanding).toBeNull()
		expect(
			activeRunOf({ ...lobby, requiredStanding: 'verified' }, 'a', sha256)
				?.requiredStanding,
		).toBe('verified')
	})

	it('is null for someone who is not playing or has left', () => {
		const lobby = started('a', 'b')
		expect(activeRunOf(lobby, 'z', sha256)).toBeNull()
		const gone = { ...lobby, players: lobby.players.filter((p) => p.id !== 'b') }
		expect(activeRunOf(gone, 'b', sha256)).toBeNull()
	})
})

describe('storage writes', () => {
	it('writes the run, a log per player, and a pointer per player', () => {
		let lobby = log2(started('a', 'b'))
		lobby = report(lobby, 'a', places('b', 'a')).lobby
		const save = saved(report(lobby, 'b', places('b', 'a'))) as Save
		const writes = runWrites(save.run, save.logs, sha256)
		const summary = writes.map((w) => [w.collection, w.key, w.userId, w.permissionRead])
		const runId = save.run.runId
		const system = '00000000-0000-0000-0000-000000000000'
		const myKey = `${String(9_999_999_999_999 - save.run.endedAt).padStart(13, '0')}:${runId}`
		expect(summary).toEqual([
			['match_runs', runId, system, 2],
			['match_logs', `${runId}:a`, system, 0],
			['my_runs', myKey, 'a', 1],
			['match_logs', `${runId}:b`, system, 0],
			['my_runs', myKey, 'b', 1],
		])
		expect(writes[1].value).toMatchObject({ eventCount: 1, truncated: false, lines: [save.logs.a.lines[0]] })
		expect(writes[1].value).not.toHaveProperty('events')
		expect(writes[3].value).toMatchObject({ eventCount: 0, lines: [] })
		expect(writes[2].value).toMatchObject({ status: 'agreed', place: 2 })
		expect(writes[4].value).toMatchObject({ place: 1 })
		// No 'chk' event in these logs, so nothing to check them against.
		expect(writes[0].value).toMatchObject({
			logChecks: { a: 'unavailable', b: 'unavailable' },
		})
		expect(writes[2].value).toMatchObject({ code: save.run.code, startedAt: save.run.startedAt })
	})
})

describe('connection record of a finished game', () => {
	it('keeps a disconnect, a rejoin and a leave on the run, and the held log counts', () => {
		let lobby = log2(started('a', 'b'))
		lobby = disconnect(lobby, 'a', 'a-s1', 1600).lobby
		lobby = join(lobby, 'a', 'a-s2', info('a'), 1700).lobby
		lobby = leave(lobby, 'b', 1800).lobby
		lobby = settle(lobby, 1900).lobby
		const save = saved(report(lobby, 'a', places('a', 'b'), 2000)) as Save
		expect(save.run.presence).toEqual([
			{ userId: 'a', kind: 'disconnected', at: 1600 },
			{ userId: 'a', kind: 'rejoined', at: 1700 },
			{ userId: 'b', kind: 'left', at: 1800 },
		])
		const writes = runWrites(save.run, save.logs, sha256)
		expect(writes[0].value).toMatchObject({ logHeld: { a: 1, b: 0 } })
	})

	it('leaves the run without a record when nobody came or went', () => {
		let lobby = report(started('a', 'b'), 'a', places('b', 'a')).lobby
		const save = saved(report(lobby, 'b', places('b', 'a'))) as Save
		expect(save.run).not.toHaveProperty('presence')
	})
})

function log2(lobby: Lobby): Lobby {
	return send(lobby, 'a', 'mpapi_log_event', { t: 1, opcode: 'play' }, 1500).lobby
}

function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex')
}
