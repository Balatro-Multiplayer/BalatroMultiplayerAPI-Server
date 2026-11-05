import { describe, expect, it } from 'vitest'
import { banNameOf } from '@bmp/types'
import { ownNameOf, shownNameOf, staffNameOf } from './shown-name.js'

const facts = {
	id: 'p-1',
	nakamaUserId: 'nk-1',
	steamName: 'RealName',
	discordUsername: 'disc',
	useDiscordName: true,
}

describe('shown-name', () => {
	it('shows the own pick when no username ban is in force', () => {
		expect(ownNameOf(facts)).toBe('disc')
		expect(shownNameOf(facts, false)).toBe('disc')
		expect(staffNameOf(facts, false)).toBe('RealName')
	})

	it('shows the Ban name to everyone while a username ban is in force', () => {
		expect(shownNameOf(facts, true)).toBe(banNameOf('nk-1'))
	})

	it('shows staff the Ban name with the real name next to it', () => {
		expect(staffNameOf(facts, true)).toBe(`${banNameOf('nk-1')} (RealName)`)
	})

	it('falls back to the player id when there is no Nakama id', () => {
		expect(shownNameOf({ ...facts, nakamaUserId: null }, true)).toBe(banNameOf('p-1'))
	})
})
