// Differential test: the server port of lib/pending_death.lua replays every
// case of the shared fixture (tests/fixtures/pending_death_cases.json in the
// PvP repo) and must give the Lua answer of the last step.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	type BlindResults,
	type PendingDeath,
	type Roster,
	addPending,
	decidePending,
	decideTeam,
	findPending,
	manyResolved,
	places,
} from './pending'

interface Step {
	fn: string
	args: unknown[]
}
interface Case {
	name: string
	out: unknown
	steps: Step[]
}

const fixture: { cases: Case[] } = JSON.parse(
	readFileSync(
		new URL('./fixtures/pending_death_cases.json', import.meta.url),
		'utf8',
	),
)

// The fixture is the Lua shape (snake_case keys).
interface LuaPending {
	player_id: string
	blind_key: string | null
	out_before: { [id: string]: boolean }
}
const toLua = (p: PendingDeath): LuaPending => ({
	player_id: p.playerId,
	blind_key: p.blindKey,
	out_before: p.outBefore,
})

// The fixture's setup step: a failure is final, a later beaten does not undo it.
function record(
	results: BlindResults,
	playerId: string,
	key: string,
	beaten: boolean,
): BlindResults {
	if (results[playerId]?.[key] === 'failed') return results
	return {
		...results,
		[playerId]: { ...results[playerId], [key]: beaten ? 'beaten' : 'failed' },
	}
}

function replay(steps: Step[]): unknown {
	let results: BlindResults = {}
	let pendings: PendingDeath[] = []
	let out: unknown
	for (const { fn, args } of steps) {
		switch (fn) {
			case 'record':
				results = record(
					results,
					args[0] as string,
					args[1] as string,
					args[2] as boolean,
				)
				out = results
				break
			case 'decide': {
				const pending = args[0] as { player_id: string; blind_key: string }
				const r = decidePending(
					{ playerId: pending.player_id, blindKey: pending.blind_key },
					args[1] as string,
					results,
					args[2] as { present: boolean; forfeited: boolean; lives: number },
				)
				out = { outcome: r.outcome, winner: r.winner }
				break
			}
			case 'add_pending':
				pendings = addPending(
					pendings,
					args[0] as string,
					args[1] as string,
					args[2] as { [id: string]: boolean } | undefined,
				)
				out = pendings.map(toLua)
				break
			case 'find_pending': {
				const found = findPending(pendings, args[0] as string)
				out = found === null ? null : toLua(found)
				break
			}
			case 'many_resolved':
				out = manyResolved(pendings, results, args[0] as Roster)
				break
			case 'places':
				out = places(pendings, results, args[1] as Roster)
				break
			case 'decide_team':
				out = {
					outcome: decideTeam(args[0] as string, results, args[1] as Roster),
					winner: null,
				}
				break
			default:
				throw new Error(`unknown fixture fn ${fn}`)
		}
	}
	return out
}

describe('pending_death_cases.json (differential against PD.*)', () => {
	it('has the 77 rows', () => {
		expect(fixture.cases).toHaveLength(77)
	})
	// The rows that only exercise the Lua `blind_key` / `record` helpers are not
	// replayed: the server has no such helpers, `record` is just a setup step above.
	// Nor are the rows that place an id the roster has no seat for: places ranks
	// the roster, so there is no such id to place.
	const placesUnseated = (c: Case): boolean =>
		c.steps.some(
			(s) =>
				s.fn === 'places' &&
				[...(s.args[0] as string[])].sort().join() !==
					Object.keys(s.args[1] as object)
						.sort()
						.join(),
		)
	const replayed = fixture.cases.filter(
		(c) => !/^(blind_key|record):/.test(c.name) && !placesUnseated(c),
	)
	it.each(replayed.map((c) => [c.name, c] as const))('%s', (_name, c) => {
		expect(replay(c.steps)).toEqual(c.out)
	})
})
