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
		expect(grantSpectator('p1', 'ABCDE')).toBe(true)
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

	it('rejects new spectators once the per-lobby cap is reached', () => {
		for (let i = 0; i < 50; i++) {
			expect(grantSpectator(`p${i}`, 'ABCDE')).toBe(true)
		}
		expect(grantSpectator('p50', 'ABCDE')).toBe(false)
		expect(countSpectators('ABCDE')).toBe(50)
	})

	it('a lobby at cap does not block spectators of a different lobby', () => {
		for (let i = 0; i < 50; i++) {
			grantSpectator(`p${i}`, 'ABCDE')
		}
		expect(grantSpectator('other', 'FGHIJ')).toBe(true)
	})
})
