import { afterEach, describe, expect, it } from 'vitest'
import {
	clearAllSpectatorGrants,
	countSpectators,
	getSpectatorGrant,
	grantSpectator,
	revokeSpectator,
} from '../../infrastructure/mqtt/spectator-registry.js'

describe('spectator-registry', () => {
	afterEach(() => {
		clearAllSpectatorGrants()
	})

	it('grants a spectator and reports the lobby they hold a grant for', () => {
		grantSpectator('p1', 'ABCDE')
		expect(getSpectatorGrant('p1')).toEqual({ lobbyCode: 'ABCDE' })
		expect(countSpectators('ABCDE')).toBe(1)
	})

	it('returns undefined for a player with no grant', () => {
		expect(getSpectatorGrant('nobody')).toBeUndefined()
	})

	it('re-granting the same lobby is idempotent', () => {
		grantSpectator('p1', 'ABCDE')
		grantSpectator('p1', 'ABCDE')
		expect(countSpectators('ABCDE')).toBe(1)
	})

	it('moves a spectator to a new lobby when re-granted elsewhere', () => {
		grantSpectator('p1', 'ABCDE')
		grantSpectator('p1', 'FGHIJ')
		expect(getSpectatorGrant('p1')).toEqual({ lobbyCode: 'FGHIJ' })
		expect(countSpectators('ABCDE')).toBe(0)
		expect(countSpectators('FGHIJ')).toBe(1)
	})

	it('revokes a grant', () => {
		grantSpectator('p1', 'ABCDE')
		revokeSpectator('p1')
		expect(getSpectatorGrant('p1')).toBeUndefined()
		expect(countSpectators('ABCDE')).toBe(0)
	})

	it('revoking a non-existent grant is a no-op', () => {
		expect(() => revokeSpectator('nobody')).not.toThrow()
	})

	it('has no per-lobby spectator cap', () => {
		for (let i = 0; i < 60; i++) {
			grantSpectator(`p${i}`, 'ABCDE')
		}
		expect(countSpectators('ABCDE')).toBe(60)
	})

	it('spectators of one lobby do not affect a different lobby', () => {
		for (let i = 0; i < 10; i++) {
			grantSpectator(`p${i}`, 'ABCDE')
		}
		grantSpectator('other', 'FGHIJ')
		expect(countSpectators('FGHIJ')).toBe(1)
	})
})
