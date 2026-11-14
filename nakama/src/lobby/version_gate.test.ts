import { describe, expect, it } from 'vitest'
import { withRules } from '../testing/pvp_rules'
import { ServerOp } from './protocol'
import { action } from './relay'
import { type Lobby, type Step, join, newLobby } from './state'

const info = (name: string, pvpVersion?: string) => ({ displayName: name, preferredJoker: null, mods: null, pvpVersion })

const ctx = { now: 1000, newSeed: () => 'SEED', newId: () => 'RUN', random: () => 0 }

function send(lobby: Lobby, from: string, key: string, params: unknown = {}) {
	return action(lobby, from, { cid: `${key}-${from}`, action: key, to: 'server', params }, ctx)
}

function rejection(step: Step): string | undefined {
	const r = step.out.filter((o) => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED)[0] as any
	return r && r.payload.reason
}

// A lobby of ready players: [id, PvP version] pairs, the first is host.
function readyLobby(modId: string, ...players: [string, string | undefined][]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId,
		maxPlayers: 8,
		creatorId: players[0][0],
		now: 0,
		graceMs: 10_000,
		resultTimeoutMs: 60_000,
	})
	lobby = { ...lobby, metadata: withRules() }
	for (const [id, version] of players) lobby = join(lobby, id, `${id}-s1`, info(id, version)).lobby
	for (const [id] of players.slice(1)) lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
	return lobby
}

describe('starting a PvP game', () => {
	it('refuses players on different PvP versions', () => {
		const lobby = readyLobby('MultiplayerPvP', ['a', '1.0.3'], ['b', '1.0.4'])
		expect(rejection(send(lobby, 'a', 'mpapi_start_game'))).toBe('version_mismatch')
	})

	it('refuses a player with no reported PvP version beside one with a version', () => {
		const lobby = readyLobby('MultiplayerPvP', ['a', '1.0.3'], ['b', undefined])
		expect(rejection(send(lobby, 'a', 'mpapi_start_game'))).toBe('version_mismatch')
	})

	it('starts when the versions are equal', () => {
		const lobby = readyLobby('MultiplayerPvP', ['a', '1.0.3'], ['b', '1.0.3'])
		const step = send(lobby, 'a', 'mpapi_start_game')
		expect(rejection(step)).toBeUndefined()
		expect(step.lobby.game.started).not.toBeNull()
	})

	it('does not check other mods', () => {
		const lobby = readyLobby('MultiplayerSPDRN', ['a', '1.0.3'], ['b', '1.0.4'])
		expect(rejection(send(lobby, 'a', 'mpapi_start_game'))).toBeUndefined()
	})
})
