import { describe, expect, it } from 'vitest'
import { chooseModelPath } from './model-path.js'

const DIR = '/model-cache'
const TUNED = `${DIR}/tuned-v2.Q8_0.gguf`

describe('chooseModelPath', () => {
	it('uses the configured path as-is when it is a model file', () => {
		expect(chooseModelPath(TUNED, 'file', [`${DIR}/other.gguf`])).toEqual({
			path: TUNED,
		})
	})

	it('returns nothing when GUARD_MODEL is unset', () => {
		expect(chooseModelPath(undefined, 'missing', [TUNED])).toEqual({
			path: undefined,
		})
	})

	// The shipped default: GUARD_MODEL is the folder, so the filename is free.
	it('loads the only model in the directory GUARD_MODEL points at', () => {
		const result = chooseModelPath(DIR, 'directory', [TUNED])

		expect(result.path).toBe(TUNED)
		expect(result.note).toContain('directory')
	})

	// Back-compat: an older config naming a file that is no longer there.
	it('falls back to the only model beside a configured path that does not exist', () => {
		const result = chooseModelPath(`${DIR}/qwen3guard.gguf`, 'missing', [TUNED])

		expect(result.path).toBe(TUNED)
		expect(result.note).toContain('does not exist')
	})

	it('ignores non-model files when finding the single candidate', () => {
		const result = chooseModelPath(DIR, 'directory', [
			`${DIR}/README.md`,
			TUNED,
			`${DIR}/.gitkeep`,
		])

		expect(result.path).toBe(TUNED)
	})

	it('matches the extension case-insensitively', () => {
		const upper = `${DIR}/Tuned-V2.Q8_0.GGUF`
		expect(chooseModelPath(DIR, 'directory', [upper]).path).toBe(upper)
	})

	// Guessing could silently run a model nobody meant to deploy.
	it('refuses to guess between multiple models and keeps failing closed', () => {
		const result = chooseModelPath(DIR, 'directory', [
			TUNED,
			`${DIR}/base.Q8_0.gguf`,
		])

		expect(result.path).toBe(DIR)
		expect(result.note).toContain('refusing to guess')
		expect(result.note).toContain('tuned-v2.Q8_0.gguf')
		expect(result.note).toContain('base.Q8_0.gguf')
	})

	it('explains an empty or unreadable directory rather than failing silently', () => {
		const result = chooseModelPath(DIR, 'directory', [])

		expect(result.path).toBe(DIR)
		expect(result.note).toContain('no .gguf found')
	})

	it('always explains itself whenever the configured path was not loaded directly', () => {
		for (const candidates of [
			[TUNED],
			[TUNED, `${DIR}/b.gguf`],
			[] as string[],
		]) {
			expect(chooseModelPath(DIR, 'directory', candidates).note).toBeTruthy()
		}
	})

	it('returns whatever path shape the caller built, including Windows paths', () => {
		const win = 'D:\\models\\tuned-v2.Q8_0.gguf'
		expect(chooseModelPath('D:\\models', 'directory', [win]).path).toBe(win)
	})
})
