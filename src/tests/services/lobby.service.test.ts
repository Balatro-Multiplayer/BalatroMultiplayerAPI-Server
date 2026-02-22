import { describe, expect, it } from 'vitest'
import { mqttService } from '../../services/mqtt.service.js'
import {
	createLobby,
	getLobbyInfo,
	getLobbyPlayers,
	joinLobby,
	leaveLobby,
	setMetadata,
} from '../../services/lobby.service.js'
import { createSession, lobbies, sessions } from '../../state/index.js'
import type { JwtPayload } from '../../types/index.js'
import { verifyJwt } from '../../services/auth.service.js'

function makePlayer(id: string, username: string): JwtPayload {
	createSession(username, { id })
	return { playerId: id, username }
}

describe('lobby.service', () => {
	describe('createLobby', () => {
		it('creates a lobby and makes the player the host', async () => {
			const player = makePlayer('host1', 'Alice')
			const { lobby, token } = await createLobby(player, 'cool_mod')

			expect(lobby.code).toHaveLength(6)
			expect(lobby.modId).toBe('cool_mod')
			expect(lobby.hostId).toBe('host1')
			expect(lobby.hasPlayer('host1')).toBe(true)
			expect(lobbies.has(lobby.code)).toBe(true)

			const decoded = verifyJwt(token)
			expect(decoded?.lobbyCode).toBe(lobby.code)
		})

		it('throws if player session does not exist', async () => {
			const player = { playerId: 'nobody', username: 'Ghost' }
			await expect(createLobby(player, 'mod1')).rejects.toThrow(
				'Player session not found',
			)
		})

		it('throws if player is already in a lobby', async () => {
			const player = makePlayer('host1', 'Alice')
			await createLobby(player, 'mod1')
			await expect(createLobby(player, 'mod2')).rejects.toThrow(
				'Already in a lobby',
			)
		})

		it('creates lobby with custom maxPlayers', async () => {
			const player = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(player, 'cool_mod', 4)

			expect(lobby.maxPlayers).toBe(4)
		})

		it('defaults maxPlayers to 16', async () => {
			const player = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(player, 'cool_mod')

			expect(lobby.maxPlayers).toBe(16)
		})
	})

	describe('joinLobby', () => {
		it('adds a player to an existing lobby', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')

			const guest = makePlayer('guest1', 'Bob')
			const result = await joinLobby(guest, lobby.code)

			expect(result.lobby.hasPlayer('guest1')).toBe(true)
			expect(result.lobby.playerCount).toBe(2)

			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				lobby.code,
				expect.objectContaining({ type: 'player_joined', playerId: 'guest1' }),
			)
		})

		it('throws if lobby does not exist', async () => {
			const player = makePlayer('p1', 'Alice')
			await expect(joinLobby(player, 'ZZZZZ')).rejects.toThrow(
				'Lobby not found',
			)
		})

		it('throws if player is already in a lobby', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')

			const guest = makePlayer('guest1', 'Bob')
			await joinLobby(guest, lobby.code)
			await expect(joinLobby(guest, lobby.code)).rejects.toThrow(
				'Already in a lobby',
			)
		})

		it('throws when lobby is full', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1', 2)

			const guest1 = makePlayer('guest1', 'Bob')
			await joinLobby(guest1, lobby.code)

			const guest2 = makePlayer('guest2', 'Charlie')
			await expect(joinLobby(guest2, lobby.code)).rejects.toThrow(
				'Lobby is full',
			)
		})
	})

	describe('leaveLobby', () => {
		it('removes a guest from the lobby', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await joinLobby(guest, lobby.code)

			const { token } = await leaveLobby(guest, lobby.code)

			expect(lobby.hasPlayer('guest1')).toBe(false)
			expect(lobby.playerCount).toBe(1)

			const decoded = verifyJwt(token)
			expect(decoded?.lobbyCode).toBeUndefined()
		})

		it('transfers host when host leaves with players remaining', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await joinLobby(guest, lobby.code)

			await leaveLobby(host, lobby.code)

			expect(lobby.hostId).toBe('guest1')
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				lobby.code,
				expect.objectContaining({
					type: 'host_changed',
					playerId: 'guest1',
				}),
			)
		})

		it('closes the lobby when last player leaves', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')
			const code = lobby.code

			await leaveLobby(host, code)

			expect(lobbies.has(code)).toBe(false)
			expect(mqttService.cleanupLobbyTopics).toHaveBeenCalledWith(code)
		})

		it('throws if lobby does not exist', async () => {
			const player = makePlayer('p1', 'Alice')
			await expect(leaveLobby(player, 'ZZZZZ')).rejects.toThrow(
				'Lobby not found',
			)
		})

		it('throws if player is not in the lobby', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')
			const outsider = makePlayer('outsider', 'Eve')

			await expect(leaveLobby(outsider, lobby.code)).rejects.toThrow(
				'Not in this lobby',
			)
		})
	})

	describe('getLobbyInfo', () => {
		it('returns the lobby', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')

			const info = getLobbyInfo(lobby.code)
			expect(info.code).toBe(lobby.code)
		})

		it('throws for unknown code', () => {
			expect(() => getLobbyInfo('ZZZZZ')).toThrow('Lobby not found')
		})
	})

	describe('getLobbyPlayers', () => {
		it('returns player list', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await joinLobby(guest, lobby.code)

			const players = getLobbyPlayers(lobby.code)
			expect(players).toEqual(
				expect.arrayContaining([
					{ id: 'host1', username: 'Alice' },
					{ id: 'guest1', username: 'Bob' },
				]),
			)
		})
	})

	describe('setMetadata', () => {
		it('allows host to set metadata', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')

			const result = await setMetadata(host, lobby.code, { ante: 1 })

			expect(result).toEqual({ ante: 1 })
			expect(lobby.metadata).toEqual({ ante: 1 })
			expect(mqttService.publishMetadata).toHaveBeenCalledWith(
				lobby.code,
				{ ante: 1 },
			)
		})

		it('merges with existing metadata', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')

			await setMetadata(host, lobby.code, { ante: 1 })
			const result = await setMetadata(host, lobby.code, { stake: 'gold' })

			expect(result).toEqual({ ante: 1, stake: 'gold' })
		})

		it('denies non-host from setting metadata', async () => {
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await joinLobby(guest, lobby.code)

			await expect(
				setMetadata(guest, lobby.code, { ante: 99 }),
			).rejects.toThrow('Only the host can set metadata')
		})
	})
})
