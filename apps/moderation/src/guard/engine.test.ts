import { describe, expect, it } from 'vitest'
import { createFakeGuardEngine, createLlamaGuardEngine } from './engine.js'

describe('createFakeGuardEngine', () => {
	it('judges by the exact text of the last (sender) turn', async () => {
		const engine = createFakeGuardEngine({
			'you suck lol': { safety: 'Controversial', categories: [] },
		})

		const result = await engine.judge([
			{ who: 'sender', text: 'gg' },
			{ who: 'other', text: 'lucky' },
			{ who: 'sender', text: 'you suck lol' },
		])

		expect(result.safety).toBe('Controversial')
		expect(result.categories).toEqual([])
		expect(result.latencyMs).toBe(0)
	})

	it('returns unknown for an unscripted message instead of throwing', async () => {
		const engine = createFakeGuardEngine({})

		const result = await engine.judge([{ who: 'sender', text: 'anything' }])

		expect(result.safety).toBe('unknown')
		expect(result.categories).toEqual([])
	})

	it('is always ready', () => {
		expect(createFakeGuardEngine({}).ready()).toBe(true)
	})
})

describe('createLlamaGuardEngine', () => {
	// The generous timeout is the point: this is the only test that imports the
	// node-llama-cpp native module, and a cold import on a CI runner routinely
	// exceeds the 5s default. Failing here blocks the deploy for a reason that
	// has nothing to do with the code under test.
	it('fails CLOSED when the native module/model cannot load: not ready, judge throws, loadError set', async () => {
		// No node-llama-cpp native binary/model is guaranteed present in this
		// environment (CI, or a droplet before the volume is mounted) — this
		// exercises exactly that fail-closed path without needing either.
		const engine = await createLlamaGuardEngine({
			modelPath: '/does/not/exist.gguf',
		})

		expect(engine.ready()).toBe(false)
		expect(engine.loadError?.()).not.toBeNull()
		await expect(engine.judge([{ who: 'sender', text: 'hi' }])).rejects.toThrow(
			/guard engine not loaded/,
		)
	}, 60_000)
})
