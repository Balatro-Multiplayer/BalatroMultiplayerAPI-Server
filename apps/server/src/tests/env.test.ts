import { describe, expect, it, vi } from 'vitest'
import { assertValidModerationConfig } from '../env.js'

describe('env.assertValidModerationConfig', () => {
	it('does nothing when the bridge is disabled (empty url)', () => {
		expect(() => assertValidModerationConfig('', '')).not.toThrow()
	})

	it('accepts a valid http(s) url with a bearer token, and does not warn', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		expect(() =>
			assertValidModerationConfig('https://moderation.example.com', 'secret'),
		).not.toThrow()
		expect(warnSpy).not.toHaveBeenCalled()
		warnSpy.mockRestore()
	})

	// A chat setting must never take down lobbies, matchmaking and games, so a
	// bad URL is reported loudly and chat fails closed instead.
	it('reports an error but does not throw when the url has no scheme', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(() =>
			assertValidModerationConfig('moderation.local', 'secret'),
		).not.toThrow()
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('MODERATION_SERVICE_URL'),
		)
		errorSpy.mockRestore()
	})

	it('reports an error but does not throw when the url uses a non-http(s) scheme', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(() =>
			assertValidModerationConfig('ftp://moderation.local', 'secret'),
		).not.toThrow()
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('http or https'),
		)
		errorSpy.mockRestore()
	})

	it('warns but does not throw when the bearer token is empty', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		expect(() =>
			assertValidModerationConfig('https://moderation.example.com', ''),
		).not.toThrow()
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('MODERATION_BEARER_TOKEN'),
		)
		warnSpy.mockRestore()
	})

	it('warns but does not throw on plaintext http in production', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		expect(() =>
			assertValidModerationConfig('http://moderation.local', 'secret', true),
		).not.toThrow()
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('plaintext http in production'),
		)
		warnSpy.mockRestore()
	})

	it('does not warn about the scheme for http outside production', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		expect(() =>
			assertValidModerationConfig('http://moderation.local', 'secret', false),
		).not.toThrow()
		expect(warnSpy).not.toHaveBeenCalled()
		warnSpy.mockRestore()
	})

	it('does not warn about the scheme for https in production', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		expect(() =>
			assertValidModerationConfig(
				'https://moderation.example.com',
				'secret',
				true,
			),
		).not.toThrow()
		expect(warnSpy).not.toHaveBeenCalled()
		warnSpy.mockRestore()
	})
})
