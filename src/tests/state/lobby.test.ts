import { describe, expect, it } from 'vitest'
import { Lobby } from '../../state/lobby.js'
import { PlayerSession } from '../../state/player.js'

describe('Lobby', () => {
	it('initializes with code, modId, and hostId', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		expect(lobby.code).toBe('ABCDE')
		expect(lobby.modId).toBe('cool_mod')
		expect(lobby.hostId).toBe('host123')
	})

	it('starts with empty players and metadata', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		expect(lobby.playerCount).toBe(0)
		expect(lobby.isEmpty).toBe(true)
		expect(lobby.metadata).toEqual({})
	})

	it('defaults maxPlayers to 16', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		expect(lobby.maxPlayers).toBe(16)
	})

	it('accepts custom maxPlayers', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123', 4)
		expect(lobby.maxPlayers).toBe(4)
	})

	it('adds a player', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		const session = new PlayerSession('Alice', { id: 'player1' })

		lobby.addPlayer(session)

		expect(lobby.playerCount).toBe(1)
		expect(lobby.isEmpty).toBe(false)
		expect(lobby.hasPlayer('player1')).toBe(true)
		expect(session.lobbyCode).toBe('ABCDE')
	})

	it('removes a player and clears their lobby code', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		const session = new PlayerSession('Alice', { id: 'player1' })
		lobby.addPlayer(session)

		lobby.removePlayer('player1')

		expect(lobby.playerCount).toBe(0)
		expect(lobby.hasPlayer('player1')).toBe(false)
		expect(session.lobbyCode).toBeUndefined()
	})

	it('removing a non-existent player is a no-op', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		lobby.removePlayer('nobody')
		expect(lobby.playerCount).toBe(0)
	})

	it('tracks multiple players', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		lobby.addPlayer(new PlayerSession('Alice', { id: 'p1' }))
		lobby.addPlayer(new PlayerSession('Bob', { id: 'p2' }))

		expect(lobby.playerCount).toBe(2)
		expect(lobby.hasPlayer('p1')).toBe(true)
		expect(lobby.hasPlayer('p2')).toBe(true)
		expect(lobby.hasPlayer('p3')).toBe(false)
	})

	it('reports isFull correctly', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123', 2)
		expect(lobby.isFull).toBe(false)

		lobby.addPlayer(new PlayerSession('Alice', { id: 'p1' }))
		expect(lobby.isFull).toBe(false)

		lobby.addPlayer(new PlayerSession('Bob', { id: 'p2' }))
		expect(lobby.isFull).toBe(true)
	})

	it('throws when adding a player to a full lobby', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123', 2)
		lobby.addPlayer(new PlayerSession('Alice', { id: 'p1' }))
		lobby.addPlayer(new PlayerSession('Bob', { id: 'p2' }))

		expect(() =>
			lobby.addPlayer(new PlayerSession('Charlie', { id: 'p3' })),
		).toThrow('Lobby is full')
	})

	it('serializes to JSON including maxPlayers', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123', 8)
		lobby.metadata = { ante: 1 }
		lobby.addPlayer(new PlayerSession('Alice', { id: 'p1' }))

		const json = lobby.toJSON()

		expect(json).toEqual({
			code: 'ABCDE',
			modId: 'cool_mod',
			hostId: 'host123',
			maxPlayers: 8,
			metadata: { ante: 1 },
			players: [{ id: 'p1', displayName: 'Alice' }],
		})
	})

	it('allows hostId to be reassigned', () => {
		const lobby = new Lobby('ABCDE', 'cool_mod', 'host123')
		lobby.hostId = 'newhost456'
		expect(lobby.hostId).toBe('newhost456')
	})
})
