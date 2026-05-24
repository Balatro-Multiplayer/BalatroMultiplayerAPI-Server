import { describe, expect, it } from 'vitest'
import { generateLobbyCode } from '../../utils/lobby-code.js'

describe('generateLobbyCode', () => {
	it('generates a 6-character code by default', () => {
		const code = generateLobbyCode()
		expect(code).toHaveLength(6)
	})

	it('generates a code of custom length', () => {
		const code = generateLobbyCode(8)
		expect(code).toHaveLength(8)
	})

	it('uses only allowed characters (no I, O, or 0)', () => {
		for (let i = 0; i < 100; i++) {
			const code = generateLobbyCode()
			expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ123456789]+$/)
			expect(code).not.toMatch(/[IO0]/)
		}
	})

	it('generates different codes on successive calls', () => {
		const codes = new Set<string>()
		for (let i = 0; i < 50; i++) {
			codes.add(generateLobbyCode())
		}
		expect(codes.size).toBe(50)
	})
})
