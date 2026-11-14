import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { activeRunOf } from '../lobby/active'
import { ServerOp } from '../lobby/protocol'
import { type RelayStep, action } from '../lobby/relay'
import { type Lobby, type Step, join, newLobby } from '../lobby/state'
import {
	MAX_RUN_SAVE_PARTS,
	MAX_RUN_SAVE_PART_BYTES,
	RUN_SAVE_PART_KEY,
} from './run_save'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})
const ctx = {
	now: 1000,
	newSeed: () => 'SEED1234',
	newId: () => 'RUN1',
	random: () => 0,
}
const HASH = 'a'.repeat(64)

function send(
	lobby: Lobby,
	from: string,
	key: string,
	params: unknown,
	to = 'server',
): RelayStep {
	return action(lobby, from, { cid: 'c', action: key, to, params }, ctx)
}

function started(ids: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'm',
		maxPlayers: 4,
		creatorId: ids[0],
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	for (const id of ids.slice(1))
		lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
	return send(lobby, ids[0], 'mpapi_start_game', {}).lobby
}

const part = (
	id: string,
	index: number,
	count: number,
	data: string,
	pos = 7,
) => ({
	run: 'RUN1',
	id,
	index,
	count,
	pos,
	hash: HASH,
	data,
})
const sendPart = (lobby: Lobby, from: string, p: unknown) =>
	send(lobby, from, RUN_SAVE_PART_KEY, p)
const rejected = (step: Step) =>
	step.out.filter((o) => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED)
const reason = (step: Step) =>
	(rejected(step)[0] as { payload: { reason: string } } | undefined)?.payload
		.reason
const sends = (step: Step) => step.out.filter((o) => o.kind === 'send')
const saves = (lobby: Lobby) => lobby.game.runSaves ?? {}

describe('run save parts', () => {
	it('keeps a save once all its parts have arrived, joined in order', () => {
		let lobby = started(['a', 'b'])
		lobby = sendPart(lobby, 'a', part('s1', 1, 2, 'WORLD')).lobby
		expect(saves(lobby).a).toBeUndefined()
		lobby = sendPart(lobby, 'a', part('s1', 0, 2, 'HELLO')).lobby
		expect(saves(lobby).a).toMatchObject({
			id: 's1',
			pos: 7,
			hash: HASH,
			data: 'HELLOWORLD',
		})
		expect(saves(lobby).b).toBeUndefined()
	})

	it('keeps the old save when the new one is missing a part', () => {
		let lobby = started(['a', 'b'])
		lobby = sendPart(lobby, 'a', part('s1', 0, 1, 'OLD', 3)).lobby
		lobby = sendPart(lobby, 'a', part('s2', 0, 3, 'x', 9)).lobby
		lobby = sendPart(lobby, 'a', part('s2', 2, 3, 'z', 9)).lobby
		expect(saves(lobby).a).toMatchObject({ id: 's1', data: 'OLD', pos: 3 })
	})

	it('replaces the save, one per player, when a newer one completes', () => {
		let lobby = started(['a', 'b'])
		lobby = sendPart(lobby, 'a', part('s1', 0, 1, 'OLD', 3)).lobby
		lobby = sendPart(lobby, 'a', part('s2', 0, 1, 'NEW', 9)).lobby
		expect(Object.keys(saves(lobby))).toEqual(['a'])
		expect(saves(lobby).a).toMatchObject({ id: 's2', data: 'NEW', pos: 9 })
	})

	it('drops an unfinished save when a newer one starts', () => {
		let lobby = started(['a', 'b'])
		lobby = sendPart(lobby, 'a', part('s1', 0, 2, 'AA')).lobby
		lobby = sendPart(lobby, 'a', part('s2', 0, 2, 'BB')).lobby
		expect(saves(lobby).a).toBeUndefined()
		lobby = sendPart(lobby, 'a', part('s2', 1, 2, 'CC')).lobby
		expect(saves(lobby).a).toMatchObject({ id: 's2', data: 'BBCC' })
	})

	it('never tells anyone, not even the sender, and never reaches spectators', () => {
		let lobby = started(['a', 'b'])
		lobby = { ...lobby, spectators: ['s'] }
		const step = sendPart(lobby, 'a', part('s1', 0, 1, 'DATA'))
		expect(sends(step)).toEqual([])
	})

	it('refuses a part for another run as wrong_run', () => {
		const lobby = started(['a', 'b'])
		const step = sendPart(lobby, 'a', {
			...part('s1', 0, 1, 'X'),
			run: 'OLDRUN',
		})
		expect(saves(step.lobby).a).toBeUndefined()
		expect(reason(step)).toBe('wrong_run')
	})

	it('refuses a part with no run, or a run that is not a string', () => {
		const lobby = started(['a', 'b'])
		const { run: _run, ...noRun } = part('s1', 0, 1, 'X')
		expect(reason(sendPart(lobby, 'a', noRun))).toBe('bad_params')
		expect(reason(sendPart(lobby, 'a', { ...noRun, run: 7 }))).toBe(
			'bad_params',
		)
		expect(saves(sendPart(lobby, 'a', noRun).lobby).a).toBeUndefined()
	})

	it('refuses a save older than the held one as stale_save', () => {
		let lobby = started(['a', 'b'])
		lobby = sendPart(lobby, 'a', part('s1', 0, 1, 'NEW', 30)).lobby
		const step = sendPart(lobby, 'a', part('s2', 0, 1, 'OLD', 25))
		expect(reason(step)).toBe('stale_save')
		expect(saves(step.lobby).a).toMatchObject({ id: 's1', pos: 30 })
		const same = sendPart(lobby, 'a', part('s3', 0, 1, 'AGAIN', 30))
		expect(rejected(same)).toEqual([])
		expect(saves(same.lobby).a).toMatchObject({ id: 's3', pos: 30 })
	})

	it('refuses malformed parts and non-participants', () => {
		const lobby = started(['a', 'b'])
		const reasons = (p: unknown, from = 'a') =>
			(
				rejected(sendPart(lobby, from, p))[0] as
					| { payload: { reason: string } }
					| undefined
			)?.payload.reason
		expect(reasons(null)).toBe('bad_params')
		expect(reasons(part('', 0, 1, 'x'))).toBe('bad_params')
		expect(reasons(part('s', 1, 1, 'x'))).toBe('bad_params')
		expect(reasons(part('s', 0, MAX_RUN_SAVE_PARTS + 1, 'x'))).toBe(
			'bad_params',
		)
		expect(
			reasons(part('s', 0, 1, 'x'.repeat(MAX_RUN_SAVE_PART_BYTES + 1))),
		).toBe('bad_params')
		expect(reasons({ ...part('s', 0, 1, 'x'), hash: 'nothex' })).toBe(
			'bad_params',
		)
		expect(reasons({ ...part('s', 0, 1, 'x'), pos: -1 })).toBe('bad_params')
		expect(sendPart(lobby, 'zed', part('s', 0, 1, 'x')).refused).toBeDefined()
		expect(reasons(part('s', 0, 1, 'x'))).toBeUndefined()
	})

	it('is gone when the match ends', () => {
		let lobby = started(['a', 'b'])
		lobby = sendPart(lobby, 'a', part('s1', 0, 1, 'DATA')).lobby
		lobby = sendPart(lobby, 'a', part('s2', 0, 2, 'DATA')).lobby
		const places = [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 2 },
		]
		lobby = send(lobby, 'a', 'mpapi_report_result', {
			placements: places,
		}).lobby
		lobby = send(lobby, 'b', 'mpapi_report_result', {
			placements: places,
		}).lobby
		expect(lobby.game.started).toBeNull()
		expect(lobby.game.runSaves).toBeUndefined()
	})

	it('does not count against the log or show in the view', () => {
		let lobby = started(['a', 'b'])
		lobby = sendPart(lobby, 'a', part('s1', 0, 1, 'DATA')).lobby
		expect(lobby.game.logs.a).toBeUndefined()
	})
})

describe('run save on rejoin', () => {
	const sha = (input: string) =>
		createHash('sha256').update(input).digest('hex')
	// Two logged events for 'a', so a save taken after 2 events has the hash of exactly those.
	const logged = (start: Lobby) => {
		const lobby = send(start, 'a', 'mpapi_log_event', {
			t: 1,
			opcode: 'play',
			args: [1],
		}).lobby
		return send(lobby, 'a', 'mpapi_log_event', {
			t: 2,
			opcode: 'buy',
			args: null,
		}).lobby
	}
	const hashAfter = (lobby: Lobby, count: number) =>
		sha(`[${(lobby.game.logs.a?.lines ?? []).slice(0, count).join(',')}]`)
	const withSave = (lobby: Lobby, pos: number, hash: string) =>
		sendPart(lobby, 'a', { ...part('s1', 0, 1, 'MINE', pos), hash }).lobby

	it('goes only to its owner with the active run', () => {
		let lobby = logged(started(['a', 'b']))
		lobby = withSave(lobby, 2, hashAfter(lobby, 2))
		const mine = activeRunOf(lobby, 'a', sha)
		expect(mine?.runSave).toEqual({
			id: 's1',
			pos: 2,
			hash: hashAfter(lobby, 2),
			data: 'MINE',
		})
		expect(mine?.runSaveSkipped).toBeNull()
		expect(activeRunOf(lobby, 'b', sha)?.runSave).toBeNull()
		expect(JSON.stringify(activeRunOf(lobby, 'b', sha))).not.toContain('MINE')
	})

	it('is null while the player has no complete save', () => {
		const lobby = sendPart(
			logged(started(['a', 'b'])),
			'a',
			part('s1', 0, 2, 'half', 2),
		).lobby
		const active = activeRunOf(lobby, 'a', sha)
		expect(active?.runSave).toBeNull()
		expect(active?.runSaveSkipped).toBeNull()
	})

	it('holds back a save whose hash is not the hash of the log up to its position', () => {
		let lobby = logged(started(['a', 'b']))
		lobby = withSave(lobby, 2, 'f'.repeat(64))
		const active = activeRunOf(lobby, 'a', sha)
		expect(active?.runSave).toBeNull()
		expect(active?.runSaveSkipped).toBe('hash_mismatch')
	})

	it('holds back a save taken after more events than the log holds', () => {
		let lobby = logged(started(['a', 'b']))
		lobby = withSave(lobby, 5, hashAfter(lobby, 2))
		const active = activeRunOf(lobby, 'a', sha)
		expect(active?.runSave).toBeNull()
		expect(active?.runSaveSkipped).toBe('beyond_log')
	})

	it('gives the log as the text the hash is taken over, so a resumed client can extend it', () => {
		const lobby = logged(started(['a', 'b']))
		expect(activeRunOf(lobby, 'a', sha)?.logText).toBe(
			`[${lobby.game.logs.a.lines.join(',')}]`,
		)
	})
})
