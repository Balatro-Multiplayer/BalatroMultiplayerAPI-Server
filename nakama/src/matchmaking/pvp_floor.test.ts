import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { PVP_UPDATE_REQUIRED_MESSAGE } from '../standing/pvp_version'
import { writeModReport } from '../standing/storage'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { beforeMatchmakerAdd } from './gate'
import { memberFactsOf } from './group/hooks'

const PVP = 'MultiplayerPvP'
const settings = { kind: 'official' } as never

type Nk = ReturnType<typeof fakeNk>
const report = (nk: Nk, userId: string, mods: string[]) =>
	writeModReport(nk as never, userId, { mods, reportedAt: 0 })

const ticket = (modId: string, mode: string, kind: 'casual' | 'ranked') => ({
	matchmakerAdd: {
		query: `+properties.modId:${modId} +properties.mode:${mode} +properties.kind:${kind}`,
		stringProperties: { modId, mode, kind },
	},
})

// What beforeMatchmakerAdd says to a player with this mod report: null when
// the ticket enters the pool, else the refusal text.
function addRefusal(
	mods: string[],
	modId: string,
	kind: 'casual' | 'ranked',
): string | null {
	const nk = fakeNk()
	report(nk, 'u1', mods)
	const mode = kind === 'ranked' ? 'pvp_ranked_balanced' : 'pvp_royale'
	try {
		beforeMatchmakerAdd(
			playerCtx('u1'),
			fakeLogger,
			nk as never,
			ticket(modId, mode, kind),
		)
		return null
	} catch (e) {
		return (e as { message: string }).message
	}
}

describe('the PvP version floor at the matchmakerAdd hook', () => {
	it.each([
		[
			'a 1.0.x casual ticket',
			['MultiplayerPvP-1.0.5'],
			'casual',
			PVP_UPDATE_REQUIRED_MESSAGE,
		],
		[
			'a 1.0.x ranked ticket',
			['MultiplayerPvP-1.0.9'],
			'ranked',
			PVP_UPDATE_REQUIRED_MESSAGE,
		],
		[
			'a 0.x ticket',
			['MultiplayerPvP-0.9.0'],
			'casual',
			PVP_UPDATE_REQUIRED_MESSAGE,
		],
		[
			'an unreadable version',
			['MultiplayerPvP-UNK'],
			'casual',
			PVP_UPDATE_REQUIRED_MESSAGE,
		],
		['the floor, 1.1.0', ['MultiplayerPvP-1.1.0'], 'casual', null],
		['a newer ranked ticket', ['MultiplayerPvP-1.2.3'], 'ranked', null],
	] as const)('%s', (_name, mods, kind, expected) => {
		expect(addRefusal([...mods], PVP, kind)).toBe(expected)
	})

	it('only asks of a PvP ticket', () => {
		expect(
			addRefusal(['MultiplayerPvP-1.0.5'], 'MultiplayerSPDRN', 'casual'),
		).toBe(null)
	})
})

describe('the PvP version floor for a group queue', () => {
	const facts = (modId: string, versions: { [id: string]: string }) => {
		const nk = fakeNk()
		const ids = Object.keys(versions)
		for (const id of ids) report(nk, id, [`MultiplayerPvP-${versions[id]}`])
		return memberFactsOf(nk as never, settings, modId, ids, null, 0).refusals
	}

	it('refuses members below the floor even when they all run the same version', () => {
		const refusals = facts(PVP, { a: '1.0.5', b: '1.0.5' })
		expect(Object.keys(refusals).sort()).toEqual(['a', 'b'])
		expect(refusals.a?.code).toBe('PVP_UPDATE_REQUIRED')
	})

	it('refuses only the member below the floor', () => {
		const refusals = facts(PVP, { a: '1.1.0', b: '1.1.0', c: '1.0.5' })
		expect(Object.keys(refusals)).toEqual(['c'])
		expect(refusals.c?.code).toBe('PVP_UPDATE_REQUIRED')
	})

	it('lets a group on the floor or above through', () => {
		expect(facts(PVP, { a: '1.1.0', b: '1.1.0' })).toEqual({})
	})

	it('only asks of a PvP group', () => {
		expect(facts('MultiplayerSPDRN', { a: '1.0.5', b: '1.0.5' })).toEqual({})
	})
})

describe('the floor against the kill switch', () => {
	it('tells a 1.0.x client to update, even for a mode that is switched off', () => {
		const nk = fakeNk()
		writeConfig(nk as never, { ...DEFAULT_CONFIG, disabledPvpModes: ['royale'] })
		report(nk, 'u1', ['MultiplayerPvP-1.0.5'])
		const attempt = (userId: string) => {
			try {
				beforeMatchmakerAdd(playerCtx(userId), fakeLogger, nk as never, ticket(PVP, 'pvp_royale', 'casual'))
				return null
			} catch (e) {
				return (e as { message: string }).message
			}
		}
		expect(attempt('u1')).toBe(PVP_UPDATE_REQUIRED_MESSAGE)
		report(nk, 'u2', ['MultiplayerPvP-1.1.0'])
		expect(attempt('u2')).toBe('mode_disabled')
	})
})
