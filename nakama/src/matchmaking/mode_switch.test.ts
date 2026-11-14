import { describe, expect, it } from 'vitest'
import { START_GAME_KEY, restartedGame } from '../actions/registry'
import { DEFAULT_CONFIG, mergeConfig, readConfig, writeConfig } from '../config'
import { disabledModesFor } from '../lobby/match'
import { ServerOp } from '../lobby/protocol'
import { rankedPinOf } from '../lobby/pvp/ranked_pin'
import type { PvpMode } from '../lobby/pvp/state'
import { action } from '../lobby/relay'
import { rpcLobbyCreate } from '../lobby/rpc'
import { type Lobby, type Step, join, newLobby, setMetadata } from '../lobby/state'
import { writeModReport } from '../standing/storage'
import { asNakama } from '../testing/casts'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { withRules } from '../testing/pvp_rules'
import { beforeMatchmakerAdd, refuseMatchedGroup } from './gate'
import { modeDisabled, ticketModeDisabled } from './mode_switch'

const PVP = 'MultiplayerPvP'
const report = (nk: ReturnType<typeof fakeNk>, ...ids: string[]) => {
	for (const id of ids)
		writeModReport(asNakama(nk), id, {
			mods: ['MultiplayerPvP-1.1.0'],
			reportedAt: 0,
		})
}
const switchOff = (
	nk: ReturnType<typeof fakeNk>,
	disabledPvpModes: PvpMode[],
) => writeConfig(asNakama(nk), { ...DEFAULT_CONFIG, disabledPvpModes })

const ticket = (modId: string, mode: string, kind: 'casual' | 'ranked') => ({
	matchmakerAdd: {
		query: `+properties.modId:${modId} +properties.mode:${mode} +properties.kind:${kind}`,
		stringProperties: { modId, mode, kind },
	},
})

const info = { displayName: 'x', preferredJoker: null, mods: null }
function startingLobby(queueMode: string, rankedMode = ''): Lobby {
	const pin = rankedMode
		? (rankedPinOf(rankedMode) as { pin: { [k: string]: unknown } }).pin
		: {}
	let lobby = newLobby({
		code: 'ABC123',
		modId: PVP,
		maxPlayers: 2,
		creatorId: 'a',
		rankedMode,
		metadata: withRules({ queue_mode: queueMode, ...pin }),
		now: 0,
		graceMs: 1000,
	})
	lobby = join(lobby, 'a', 'sa', info, 0).lobby
	lobby = join(lobby, 'b', 'sb', info, 0).lobby
	return action(
		lobby,
		'b',
		{ cid: 'r', action: 'mpapi_ready', to: 'server', params: { ready: true } },
		{ now: 1, newSeed: () => 'S', newId: () => 'R', random: () => 0 },
	).lobby
}
function start(lobby: Lobby, disabled: PvpMode[]): Step {
	return action(
		lobby,
		'a',
		{ cid: 's', action: START_GAME_KEY, to: 'server', params: {} },
		{ now: 2, newSeed: () => 'S', newId: () => 'R', random: () => 0 },
		disabled,
	)
}
function rejection(step: Step): string | undefined {
	const out = step.out.find(
		(o) => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED,
	)
	return out && out.kind === 'send'
		? (out.payload as { reason: string }).reason
		: undefined
}

// Each refusal point asks the same question: is this mode off? `refused` says
// whether the point turned it away with mode_disabled.
type Point = (disabled: PvpMode[], mode: PvpMode | 'ranked') => boolean

const atQueue: Point = (disabled, mode) => {
	const nk = fakeNk()
	report(nk, 'u1')
	switchOff(nk, disabled)
	const env =
		mode === 'ranked'
			? ticket(PVP, 'pvp_ranked_balanced', 'ranked')
			: ticket(PVP, `pvp_${mode}`, 'casual')
	try {
		beforeMatchmakerAdd(playerCtx('u1'), fakeLogger, asNakama(nk), env)
		return false
	} catch (e) {
		expect((e as { message: string }).message).toBe('mode_disabled')
		return true
	}
}

const atLobbyCreate: Point = (disabled, mode) => {
	// A casual lobby names no mode at create; only a ranked one (dev servers) can be refused here.
	const nk = fakeNk({ matchCreate: () => 'm1.node' })
	switchOff(nk, disabled)
	const ctx = playerCtx('u1', { BMP_SERVER_KIND: 'dev' })
	const payload = JSON.stringify({
		modId: PVP,
		rankedMode: 'pvp_ranked_balanced',
	})
	if (mode !== 'ranked') return false
	try {
		rpcLobbyCreate(ctx, fakeLogger, asNakama(nk), payload)
		return false
	} catch (e) {
		expect((e as { message: string }).message).toBe('mode_disabled')
		return true
	}
}

const atStart: Point = (disabled, mode) => {
	const lobby =
		mode === 'ranked'
			? startingLobby('pvp_nemesis', 'pvp_ranked_balanced')
			: startingLobby(`pvp_${mode}`)
	const step = start(lobby, disabled)
	const reason = rejection(step)
	if (reason === undefined) {
		expect(step.lobby.game.started).not.toBeNull()
		return false
	}
	expect(reason).toBe('mode_disabled')
	return true
}

describe.each([
	['the matchmakerAdd hook', atQueue],
	['lobby create', atLobbyCreate],
	['game start', atStart],
] as const)('the mode kill switch at %s', (_name, point) => {
	it('lets an enabled mode through', () => {
		expect(point([], 'royale')).toBe(false)
		expect(point(['royale'], 'nemesis')).toBe(false)
		expect(point(['royale'], 'ranked')).toBe(false)
	})
	it('refuses ranked when nemesis is disabled', () => {
		expect(point(['nemesis'], 'ranked')).toBe(true)
	})
})

describe.each([
	['the matchmakerAdd hook', atQueue],
	['game start', atStart],
] as const)('the mode kill switch at %s, casual modes', (_name, point) => {
	it.each(['royale', 'nemesis', 'manhunt', 'teams'] as const)(
		'refuses %s only when it is listed',
		(mode) => {
			expect(point([mode], mode)).toBe(true)
			const others = (
				['royale', 'nemesis', 'manhunt', 'teams'] as const
			).filter((m) => m !== mode)
			expect(point(others, mode)).toBe(false)
		},
	)
})

describe('the mode kill switch at the match', () => {
	const plan = (rankedMode: string, gameMode: string) => ({
		modId: PVP,
		rankedMode,
		gameMode: rankedMode ? `ranked:${rankedMode}` : gameMode,
		playerIds: ['a', 'b'],
		groups: [],
		teamPlan: null,
		requiredStanding: 'valid' as const,
	})
	it.each([
		['casual royale off', ['royale'], '', 'pvp_royale', true],
		['casual royale, teams off', ['teams'], '', 'pvp_royale', false],
		['ranked, nemesis off', ['nemesis'], 'pvp_ranked_balanced', '', true],
		['ranked, royale off', ['royale'], 'pvp_ranked_balanced', '', false],
	] as const)('%s', (_name, disabled, rankedMode, gameMode, refused) => {
		const nk = fakeNk()
		report(nk, 'a', 'b')
		switchOff(nk, [...disabled])
		const settings = { kind: 'official' } as never
		expect(
			refuseMatchedGroup(
				asNakama(nk),
				settings,
				fakeLogger,
				plan(rankedMode, gameMode),
			),
		).toBe(refused)
	})

	it('warns of a malformed stored list it has to drop', () => {
		const nk = fakeNk()
		report(nk, 'a', 'b')
		switchOff(nk, ['Royale' as PvpMode])
		const seen: string[] = []
		const logger = { ...fakeLogger, warn: (m: string) => void seen.push(m) }
		expect(
			refuseMatchedGroup(
				asNakama(nk),
				{ kind: 'official' } as never,
				logger,
				plan('', 'pvp_royale'),
			),
		).toBe(false)
		expect(seen.some((m) => m.includes('disabledPvpModes'))).toBe(true)
	})
})

describe('modeDisabled and ticketModeDisabled', () => {
	it.each([
		[[], 'royale', false, false],
		[['royale'], 'royale', false, true],
		[['royale'], 'nemesis', false, false],
		[['nemesis'], 'nemesis', true, true],
		[['nemesis'], null, true, true],
		[['royale'], null, true, false],
		[['royale'], null, false, false],
	] as const)(
		'%j mode %s ranked %s -> %s',
		(disabled, mode, ranked, expected) => {
			expect(modeDisabled(disabled, mode as PvpMode | null, ranked)).toBe(
				expected,
			)
		},
	)
	it('ignores another mod, and a queue name that is no PvP queue', () => {
		expect(
			ticketModeDisabled(
				['nemesis', 'royale', 'teams', 'manhunt'],
				'MultiplayerSPDRN',
				'pvp_royale',
				false,
			),
		).toBe(false)
		expect(
			ticketModeDisabled(
				['nemesis', 'royale', 'teams', 'manhunt'],
				'MultiplayerSPDRN',
				'duel',
				true,
			),
		).toBe(false)
		expect(ticketModeDisabled(['royale'], PVP, 'standard', false)).toBe(false)
	})
	it('reads the experimental and small world queues as the modes they play', () => {
		expect(
			ticketModeDisabled(['nemesis'], PVP, 'pvp_experimental', false),
		).toBe(true)
		expect(ticketModeDisabled(['royale'], PVP, 'pvp_smallworld', false)).toBe(
			true,
		)
	})
})

describe('the disabledPvpModes config value', () => {
	it('is empty before the API pushes anything, and is read back from storage', () => {
		const nk = fakeNk()
		expect(readConfig(asNakama(nk)).disabledPvpModes).toEqual([])
		switchOff(nk, ['teams', 'royale'])
		expect(readConfig(asNakama(nk)).disabledPvpModes).toEqual(['teams', 'royale'])
	})
	it.each([
		['a push of known modes', ['royale', 'manhunt'], ['royale', 'manhunt']],
		['an empty list clears it', [], []],
		['an unknown mode', ['royale', 'duel'], ['teams']],
		['a duplicate', ['royale', 'royale'], ['teams']],
		['a non-array', 'royale', ['teams']],
		['a non-string entry', [1], ['teams']],
		['null', null, ['teams']],
	])('%s', (_name, pushed, expected) => {
		const current = {
			...DEFAULT_CONFIG,
			disabledPvpModes: ['teams' as PvpMode],
		}
		expect(
			mergeConfig(current, { disabledPvpModes: pushed }).disabledPvpModes,
		).toEqual(expected)
	})
	it('is left alone by a push that does not mention it', () => {
		const current = {
			...DEFAULT_CONFIG,
			disabledPvpModes: ['teams' as PvpMode],
		}
		expect(
			mergeConfig(current, { rankedEnabled: false }).disabledPvpModes,
		).toEqual(['teams'])
	})
})

describe('queue_mode once a game has started', () => {
	const refusalKeys = (step: Step) =>
		step.out.flatMap((o) =>
			o.kind === 'send' &&
			o.op === ServerOp.ERROR &&
			(o.payload as { reason?: string }).reason === 'bad_rules'
				? [(o.payload as { key: string }).key]
				: [],
		)
	const started = () => {
		const step = start(startingLobby('pvp_royale'), ['teams'])
		expect(step.lobby.game.started).not.toBeNull()
		return step.lobby
	}

	it('refuses a write of another mode in the batch that follows the start, so teams never freezes', () => {
		const step = setMetadata(started(), 'a', { queue_mode: 'pvp_teams' })
		expect(refusalKeys(step)).toEqual(['queue_mode'])
		expect(step.lobby.metadata.queue_mode).toBe('pvp_royale')
	})
	it('lets the same mode through, and the keys written beside a refused one', () => {
		const same = setMetadata(started(), 'a', { queue_mode: 'pvp_royale' })
		expect(refusalKeys(same)).toEqual([])
		const mixed = setMetadata(started(), 'a', {
			queue_mode: 'pvp_teams',
			note: 'x',
		})
		expect(refusalKeys(mixed)).toEqual(['queue_mode'])
		expect(mixed.lobby.metadata).toMatchObject({
			queue_mode: 'pvp_royale',
			note: 'x',
		})
	})
	it('refuses it in a restarted run too, so a restart cannot switch the mode', () => {
		const lobby = started()
		const restarted = restartedGame(lobby, {
			now: 3,
			newSeed: () => 'S2',
			newId: () => 'R2',
			random: () => 0,
		})
		expect(restarted).not.toBeNull()
		const next = { ...lobby, game: (restarted as { game: Lobby['game'] }).game }
		const step = setMetadata(next, 'a', { queue_mode: 'pvp_teams' })
		expect(refusalKeys(step)).toEqual(['queue_mode'])
		expect(step.lobby.metadata.queue_mode).toBe('pvp_royale')
	})
	it('leaves the mode writable before a game starts', () => {
		const lobby = startingLobby('pvp_royale')
		const step = setMetadata(lobby, 'a', { queue_mode: 'pvp_teams' })
		expect(refusalKeys(step)).toEqual([])
		expect(step.lobby.metadata.queue_mode).toBe('pvp_teams')
	})
	it('leaves another mod alone', () => {
		const lobby = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerSPDRN',
			maxPlayers: 2,
			creatorId: 'a',
			metadata: { queue_mode: 'x' },
			now: 0,
			graceMs: 1000,
		})
		const joined = join(lobby, 'a', 'sa', info, 0).lobby
		const running = { ...joined, game: { ...joined.game, started: started().game.started } }
		const step = setMetadata(running, 'a', { queue_mode: 'y' })
		expect(refusalKeys(step)).toEqual([])
	})
})

describe('disabledModesFor', () => {
	it('reads the stored list for a game start only', () => {
		let reads = 0
		const read = (): PvpMode[] => {
			reads += 1
			return ['royale']
		}
		expect(disabledModesFor({ action: START_GAME_KEY }, read)).toEqual(['royale'])
		expect(reads).toBe(1)
		expect(disabledModesFor({ action: 'mpapi_other' }, read)).toEqual([])
		expect(disabledModesFor({}, read)).toEqual([])
		expect(reads).toBe(1)
	})
})
