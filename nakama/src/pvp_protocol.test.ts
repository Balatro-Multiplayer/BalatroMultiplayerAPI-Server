import { describe, expect, it } from 'vitest'
import { PVP_PROTOCOL, rpcPvpProtocol } from './pvp_protocol'
import { fakeLogger, fakeNk, playerCtx } from './testing/fake_nk'

describe('rpcPvpProtocol', () => {
	it('answers the protocol constant as JSON, to an empty payload', () => {
		const out = rpcPvpProtocol(
			playerCtx('u1'),
			fakeLogger,
			fakeNk() as never,
			'',
		)
		expect(JSON.parse(out)).toEqual({ protocol: PVP_PROTOCOL })
		expect(out).toBe('{"protocol":1}')
	})

	it('answers the same to a payload that is not empty', () => {
		const out = rpcPvpProtocol(
			playerCtx('u1'),
			fakeLogger,
			fakeNk() as never,
			'{}',
		)
		expect(out).toBe(JSON.stringify({ protocol: PVP_PROTOCOL }))
	})

	it('is a whole number a client can compare with its floor', () => {
		expect(Number.isInteger(PVP_PROTOCOL)).toBe(true)
		expect(PVP_PROTOCOL).toBeGreaterThanOrEqual(1)
	})
})
