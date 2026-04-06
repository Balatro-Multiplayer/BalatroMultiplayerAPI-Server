import { describe, expect, it } from 'vitest'
import { PlayerSession } from '../../state/player.js'

describe('PlayerSession', () => {
	it('generates a UUID playerId', () => {
		const session = new PlayerSession('Alice')
		expect(session.playerId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		)
	})

	it('initializes with steam name', () => {
		const session = new PlayerSession('Alice')
		expect(session.steamName).toBe('Alice')
	})

	it('accepts optional steamIdHash and discordIdHash', () => {
		const session = new PlayerSession('Alice', {
			steamIdHash: 'steam123',
			discordIdHash: 'discord456',
		})
		expect(session.steamIdHash).toBe('steam123')
		expect(session.discordIdHash).toBe('discord456')
	})

	it('starts with no lobby code', () => {
		const session = new PlayerSession('Alice')
		expect(session.lobbyCode).toBeUndefined()
	})

	it('generates unique IDs for different sessions', () => {
		const a = new PlayerSession('Alice')
		const b = new PlayerSession('Bob')
		expect(a.playerId).not.toBe(b.playerId)
	})
})
