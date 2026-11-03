import { describe, expect, it } from 'vitest'
import { REJOIN_REFUSED_PREFIX, rejoinRefusal, rejoinRejectMessage } from './rejoin'

const VALID = { standing: 'valid' as const, disallowed: [], reason: null }
const VERIFIED = { standing: 'verified' as const, disallowed: [], reason: null }
const MODS = { standing: 'none' as const, disallowed: ['Cryptid'], reason: 'mods_not_allowed' as const }
const UNREPORTED = { standing: 'none' as const, disallowed: [], reason: 'unreported' as const }

describe('rejoinRefusal', () => {
	it('never gates a lobby without a bar (private, or made before standings)', () => {
		expect(rejoinRefusal(undefined, MODS)).toBeNull()
	})
	it('a casual game wants valid again, from a report', () => {
		expect(rejoinRefusal('valid', VALID)).toBeNull()
		expect(rejoinRefusal('valid', VERIFIED)).toBeNull()
		expect(rejoinRefusal('valid', MODS)).toEqual({ reason: 'mods_not_allowed', mods: ['Cryptid'] })
		expect(rejoinRefusal('valid', UNREPORTED)).toEqual({ reason: 'mods_unreported' })
	})
	it('a ranked game wants the launcher verdict', () => {
		expect(rejoinRefusal('verified', VERIFIED)).toBeNull()
		expect(rejoinRefusal('verified', VALID)).toEqual({ reason: 'verification_pending' })
		expect(rejoinRefusal('verified', MODS)).toEqual({ reason: 'verification_pending' })
	})
	it('a ranked game tells a failed verdict apart from no verdict', () => {
		expect(rejoinRefusal('verified', VALID, true)).toEqual({ reason: 'verification_failed' })
		expect(rejoinRefusal('verified', MODS, true)).toEqual({ reason: 'verification_failed' })
		expect(rejoinRefusal('verified', VERIFIED, true)).toBeNull()
		expect(rejoinRefusal('valid', MODS, true)).toEqual({ reason: 'mods_not_allowed', mods: ['Cryptid'] })
	})
})

describe('rejoinRejectMessage', () => {
	it('is the prefix and a JSON view a client can parse', () => {
		const text = rejoinRejectMessage({ reason: 'mods_not_allowed', mods: ['Cryptid', 'Talisman'] })
		expect(text.indexOf(REJOIN_REFUSED_PREFIX)).toBe(0)
		expect(JSON.parse(text.slice(REJOIN_REFUSED_PREFIX.length))).toEqual({
			reason: 'mods_not_allowed',
			mods: ['Cryptid', 'Talisman'],
			message: "These mods aren't allowed in this game: Cryptid, Talisman",
		})
		expect(JSON.parse(rejoinRejectMessage({ reason: 'verification_pending' }).slice(REJOIN_REFUSED_PREFIX.length)).mods).toEqual([])
		expect(JSON.parse(rejoinRejectMessage({ reason: 'verification_failed' }).slice(REJOIN_REFUSED_PREFIX.length))).toEqual({
			reason: 'verification_failed',
			mods: [],
			message: 'This ranked game needs a verified BET Launcher.',
		})
	})
})
