import { describe, expect, it } from 'vitest'
import {
	normalizeRepoUrl,
	planModRowClaims,
} from '../../features/mods/mod-registry-claims.js'

function row(
	id: string,
	repoUrl: string | null = null,
	thunderstoreFullName: string | null = null,
) {
	return { id, repoUrl, thunderstoreFullName }
}

function pkg(fullName: string, repoUrl: string | null = null) {
	return { fullName, repoUrl }
}

describe('normalizeRepoUrl', () => {
	it('treats protocol, www., trailing slash, .git and case as the same repo', () => {
		const forms = [
			'https://github.com/Foo/Bar',
			'http://www.github.com/Foo/Bar/',
			'https://github.com/foo/bar.git',
		]
		expect(new Set(forms.map(normalizeRepoUrl)).size).toBe(1)
	})

	it('returns null for empty input', () => {
		expect(normalizeRepoUrl(null)).toBeNull()
		expect(normalizeRepoUrl('  ')).toBeNull()
	})
})

describe('planModRowClaims', () => {
	it('keeps a row the package already owns', () => {
		const claims = planModRowClaims(
			[pkg('Alice-Mod')],
			[row('Alice@Mod', null, 'Alice-Mod')],
		)
		expect(claims.get('Alice-Mod')).toEqual({ kind: 'owned', id: 'Alice@Mod' })
	})

	it('claims a carried-over row by repo URL, keeping its legacy id', () => {
		const claims = planModRowClaims(
			[pkg('Alice-Mod', 'https://github.com/Alice/Mod')],
			[row('Alice@Mod', 'https://github.com/alice/mod.git')],
		)
		expect(claims.get('Alice-Mod')).toEqual({
			kind: 'claimed',
			id: 'Alice@Mod',
		})
	})

	it('claims the hardcoded legacy ids by alias even when repo URLs differ', () => {
		const claims = planModRowClaims(
			[
				pkg(
					'BalatroMultiplayer-MultiplayerSpeedrun',
					'https://github.com/Balatro-Multiplayer/BalatroMultiplayerSpeedrun',
				),
				pkg('Steamodded-Steamodded', 'https://smods.dev'),
			],
			[
				row(
					'MultiplayerSPDRN',
					'https://github.com/V-rtualized/BalatroSpeedrunning',
				),
				row('smods', 'https://github.com/Steamodded/smods'),
			],
		)
		expect(claims.get('BalatroMultiplayer-MultiplayerSpeedrun')).toEqual({
			kind: 'claimed',
			id: 'MultiplayerSPDRN',
		})
		expect(claims.get('Steamodded-Steamodded')).toEqual({
			kind: 'claimed',
			id: 'smods',
		})
	})

	it('lets an alias win a row over a different package sharing its repo URL', () => {
		const claims = planModRowClaims(
			[
				pkg('Someone-Fork', 'https://github.com/Steamodded/smods'),
				pkg('Steamodded-Steamodded', 'https://smods.dev'),
			],
			[row('smods', 'https://github.com/Steamodded/smods')],
		)
		expect(claims.get('Steamodded-Steamodded')).toEqual({
			kind: 'claimed',
			id: 'smods',
		})
		expect(claims.get('Someone-Fork')).toEqual({
			kind: 'new',
			id: 'Someone-Fork',
		})
	})

	it('claims each row at most once when two packages share a repo URL', () => {
		const claims = planModRowClaims(
			[
				pkg('Alice-Mod', 'https://github.com/Alice/Mod'),
				pkg('Alice-ModBeta', 'https://github.com/Alice/Mod'),
			],
			[row('Alice@Mod', 'https://github.com/Alice/Mod')],
		)
		expect(claims.get('Alice-Mod')).toEqual({
			kind: 'claimed',
			id: 'Alice@Mod',
		})
		expect(claims.get('Alice-ModBeta')).toEqual({
			kind: 'new',
			id: 'Alice-ModBeta',
		})
	})

	it('never claims a row another package already owns', () => {
		const claims = planModRowClaims(
			[pkg('Bob-Mod', 'https://github.com/Alice/Mod')],
			[row('Alice@Mod', 'https://github.com/Alice/Mod', 'Alice-Mod')],
		)
		expect(claims.get('Bob-Mod')).toEqual({ kind: 'new', id: 'Bob-Mod' })
	})

	it('reuses an unowned row whose id is already the full name', () => {
		const claims = planModRowClaims([pkg('Alice-Mod')], [row('Alice-Mod')])
		expect(claims.get('Alice-Mod')).toEqual({
			kind: 'claimed',
			id: 'Alice-Mod',
		})
	})

	it('inserts a new row keyed by full name when nothing matches', () => {
		const claims = planModRowClaims(
			[pkg('Carol-New', 'https://github.com/Carol/New')],
			[row('Alice@Mod', 'https://github.com/Alice/Mod')],
		)
		expect(claims.get('Carol-New')).toEqual({ kind: 'new', id: 'Carol-New' })
	})
})
