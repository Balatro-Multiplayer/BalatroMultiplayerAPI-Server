import { describe, expect, it } from 'vitest'
import {
	canonicalVersionKey,
	foldGithubVersions,
	matchesVersion,
	thunderstoreAliases,
} from '../../features/mods/mod-version-aliases.js'

describe('thunderstoreAliases', () => {
	it('gives every version its v-prefixed GitHub spelling', () => {
		expect(thunderstoreAliases('Alice-Mod', '1.2.0')).toEqual(['v1.2.0'])
	})

	it("maps Steamodded's 1.NNNN.0 back to its GitHub beta tags", () => {
		expect(thunderstoreAliases('Steamodded-Steamodded', '1.1814.0')).toEqual([
			'v1.1814.0',
			'1.0.0-beta-1814a',
			'1.0.0-beta-1814',
		])
		expect(thunderstoreAliases('Steamodded-Steamodded', '1.827.0')).toContain(
			'1.0.0-beta-0827a',
		)
	})

	it("maps the patch number to the tag's letter", () => {
		expect(thunderstoreAliases('Steamodded-Steamodded', '1.1606.1')).toEqual([
			'v1.1606.1',
			'1.0.0-beta-1606b',
		])
		expect(thunderstoreAliases('Steamodded-Steamodded', '1.827.2')).toEqual([
			'v1.827.2',
			'1.0.0-beta-0827c',
		])
		expect(
			thunderstoreAliases('Steamodded-Steamodded', '1.1531.999999'),
		).toEqual(['v1.1531.999999'])
	})

	it('adds no beta alias to a non-Steamodded mod or a non-beta version', () => {
		expect(thunderstoreAliases('Alice-Mod', '1.1814.0')).toEqual(['v1.1814.0'])
		expect(thunderstoreAliases('Steamodded-Steamodded', '26.829.0')).toEqual([
			'v26.829.0',
		])
	})
})

describe('canonicalVersionKey', () => {
	it('ignores case and a leading v, but not other prefixes', () => {
		expect(canonicalVersionKey('V1.2.0', false)).toBe('1.2.0')
		expect(canonicalVersionKey('version-1.2.0', false)).toBe('version-1.2.0')
	})

	it("maps Steamodded's beta tags, letter suffix or not", () => {
		expect(canonicalVersionKey('1.0.0-beta-1814a', true)).toBe('1.1814.0')
		expect(canonicalVersionKey('1.0.0-beta-0827c', true)).toBe('1.827.2')
		expect(canonicalVersionKey('1.0.0-beta-0827', true)).toBe('1.827.0')
		expect(canonicalVersionKey('1.0.0-beta-1606b', true)).toBe('1.1606.1')
		expect(canonicalVersionKey('1.0.0-beta-1814a', false)).toBe(
			'1.0.0-beta-1814a',
		)
	})
})

describe('foldGithubVersions', () => {
	const gh = (name: string) => ({ name })

	it('folds same-release tags into the Thunderstore version and keeps the rest', () => {
		const { aliases, githubOnly } = foldGithubVersions(
			['1.2.0', '1.1.0'],
			[gh('v1.2.0'), gh('1.1.0'), gh('v1.3.0-beta'), gh('nightly')],
			false,
		)
		expect(Object.fromEntries(aliases)).toEqual({ '1.2.0': ['v1.2.0'] })
		expect(githubOnly.map((v) => v.name)).toEqual(['v1.3.0-beta', 'nightly'])
	})

	it('folds Steamodded beta tags into their Thunderstore number', () => {
		const { aliases, githubOnly } = foldGithubVersions(
			['1.1814.0'],
			[gh('1.0.0-beta-1814a'), gh('1.0.0-beta-1815a')],
			true,
		)
		expect(aliases.get('1.1814.0')).toEqual(['1.0.0-beta-1814a'])
		expect(githubOnly.map((v) => v.name)).toEqual(['1.0.0-beta-1815a'])
	})
})

describe('matchesVersion', () => {
	it('matches the name or any alias, case-insensitively', () => {
		const row = { version: '1.1814.0', aliases: ['1.0.0-beta-1814a'] }
		expect(matchesVersion(row, '1.1814.0')).toBe(true)
		expect(matchesVersion(row, '1.0.0-BETA-1814A')).toBe(true)
		expect(matchesVersion(row, '1.0.0-beta-1815a')).toBe(false)
	})
})
