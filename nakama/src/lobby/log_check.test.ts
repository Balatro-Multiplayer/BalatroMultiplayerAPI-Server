import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkLog, hashInput, logGapsOf } from './log_check'

const sha256 = (input: string) => createHash('sha256').update(input).digest('hex')

// What api/replay/recorder.lua's canonical_hash_input builds for these events
// -- keys in the client's order, not alphabetical.
const LUA_INPUT = '[[1,"lobby_info",{"ruleset":"y","gamemode":"x"}],[2,"play",[1,[2,3]]],[3,"reroll",null]]'

function logWith(carbon: string, extra: string[] = []) {
	return {
		lines: [
			'[1,"lobby_info",{"ruleset":"y","gamemode":"x"}]',
			'[2,"play",[1,[2,3]]]',
			'[3,"reroll",null]',
			...extra,
			'[4,"end",{"result":"win"}]',
			`[5,"chk",{"human":"00000000","carbon":"${carbon}","bytes":10}]`,
		],
		bytes: 0,
		truncated: false,
	}
}

describe('log check', () => {
	it('hashes the gameplay events as they arrived, the way the client does', () => {
		expect(hashInput(logWith('x').lines)).toBe(LUA_INPUT)
	})

	it('matches an untouched log', () => {
		expect(checkLog(logWith(sha256(LUA_INPUT)), sha256)).toEqual({
			carbonHash: sha256(LUA_INPUT),
			check: 'match',
		})
	})

	it('flags a log that differs from its hash', () => {
		const log = logWith(sha256(LUA_INPUT), ['[3,"buy",[7]]'])
		expect(checkLog(log, sha256).check).toBe('mismatch')
	})

	it('cannot check a log with no chk, a truncated log, or no log', () => {
		const noChk = { ...logWith('x'), lines: logWith('x').lines.slice(0, 4) }
		expect(checkLog(noChk, sha256).check).toBe('unavailable')
		expect(checkLog({ ...logWith(sha256(LUA_INPUT)), truncated: true }, sha256).check).toBe(
			'unavailable',
		)
		expect(checkLog(undefined, sha256)).toEqual({ carbonHash: null, check: 'unavailable' })
	})

	it('calls a log with a gap incomplete, not a mismatch', () => {
		const gapped = { ...logWith(sha256(LUA_INPUT), ['[3,"buy",[7]]']), seq: 6, ahead: 9 }
		expect(logGapsOf(gapped)).toBe(3)
		expect(checkLog(gapped, sha256).check).toBe('incomplete')
		// even a log whose hash would differ
		expect(checkLog({ ...logWith('0'.repeat(64)), seq: 5, ahead: 6 }, sha256).check).toBe('incomplete')
	})

	it('still flags a complete log whose hash differs', () => {
		const complete = { ...logWith('0'.repeat(64)), seq: 5, ahead: 5 }
		expect(logGapsOf(complete)).toBe(0)
		expect(checkLog(complete, sha256).check).toBe('mismatch')
		expect(logGapsOf(undefined)).toBe(0)
		expect(logGapsOf(logWith('x'))).toBe(0)
	})
})
