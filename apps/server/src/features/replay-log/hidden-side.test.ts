import { describe, expect, it } from 'vitest'
import {
	compressToBase64,
	decompressFromBase64,
} from '../../shared/utils/compression.js'
import { reduceToResultOnly } from './hidden-side.js'

type Tuple = [number, string, unknown]

const encode = (events: Tuple[]) => compressToBase64(JSON.stringify(events))
const decode = (block: string) =>
	JSON.parse(decompressFromBase64(block)) as Tuple[]

describe('reduceToResultOnly', () => {
	it('drops hands, shop, jokers, idol rolls and the deck', () => {
		const block = encode([
			[0, 'run_info', { seed: 'ABC', deck: 'b_red', stake: 1 }],
			[1, 'select_blind', [0, 'bl_small']],
			[2, 'play', [[1, 2], [[-1, 'S', 'A']], []]],
			[3, 'discard', [[1], [[2, 'S', 'K']]]],
			[4, 'buy', [1, 2, 3]],
			[5, 'idol_roll', [3, 'x', []]],
			[6, 'money_delta', [-4]],
			[7, 'deck_snapshot', [['AS']]],
			[8, 'reroll', []],
		])
		expect(decode(reduceToResultOnly(block))).toEqual([
			[1, 'select_blind', [null, 'bl_small']],
		])
	})

	it('keeps the result and lives lost', () => {
		const block = encode([
			[1, 'life_lost', { lost: 1, lives: 3 }],
			[2, 'end', { result: 'win', extra: 'secret' }],
			[3, 'chk', { hash: 'x' }],
		])
		expect(decode(reduceToResultOnly(block))).toEqual([
			[1, 'life_lost', { lost: 1, lives: 3 }],
			[2, 'end', { result: 'win' }],
		])
	})

	it('keeps only the last non-zero score of each PvP blind', () => {
		const block = encode([
			[1, 'select_blind', [0, 'bl_small']],
			[2, 'hand_result', ['100', 3]],
			[3, 'select_blind', [0, 'bl_mp_nemesis']],
			[4, 'hand_result', ['500', 3]],
			[5, 'hand_result', ['1,200', 2]],
			[6, 'hand_result', ['0', 1]],
			[7, 'select_blind', [0, 'bl_mp_nemesis']],
			[8, 'hand_result', ['70', 3]],
		])
		expect(decode(reduceToResultOnly(block))).toEqual([
			[1, 'select_blind', [null, 'bl_small']],
			[3, 'select_blind', [null, 'bl_mp_nemesis']],
			[5, 'hand_result', ['1,200']],
			[7, 'select_blind', [null, 'bl_mp_nemesis']],
			[8, 'hand_result', ['70']],
		])
	})

	it('keeps no score when the blind key is missing: it does not guess the PvP blind', () => {
		const block = encode([
			[1, 'select_blind', [0]],
			[2, 'skip_blind', 0],
			[3, 'select_blind', [0]],
			[4, 'hand_result', ['9', 1]],
		])
		expect(decode(reduceToResultOnly(block))).toEqual([
			[1, 'select_blind', [null, null]],
			[2, 'skip_blind', [null, null]],
			[3, 'select_blind', [null, null]],
		])
	})

	it('drops scores after a skipped blind and in non-PvP blinds', () => {
		const block = encode([
			[1, 'select_blind', [0, 'bl_mp_nemesis']],
			[2, 'skip_blind', 0],
			[3, 'hand_result', ['50', 3]],
			[4, 'select_blind', [0, 'bl_hook']],
			[5, 'hand_result', ['60', 3]],
		])
		expect(decode(reduceToResultOnly(block)).map((e) => e[1])).toEqual([
			'select_blind',
			'skip_blind',
			'select_blind',
		])
	})

	it('keeps only lost and lives of a life_lost event', () => {
		const block = encode([
			[1, 'life_lost', { lost: 2, lives: 1, opponent: 'p2', note: 'x' }],
			[2, 'life_lost', 'odd'],
		])
		expect(decode(reduceToResultOnly(block))).toEqual([
			[1, 'life_lost', { lost: 2, lives: 1 }],
			[2, 'life_lost', {}],
		])
	})

	it('reads zero scores in every form the log used', () => {
		const block = encode([
			[1, 'select_blind', [0, 'bl_mp_nemesis']],
			[2, 'hand_result', ['5', 3]],
			[3, 'hand_result', ['0', 2]],
			[4, 'hand_result', ['0.0', 1]],
		])
		expect(decode(reduceToResultOnly(block))).toEqual([
			[1, 'select_blind', [null, 'bl_mp_nemesis']],
			[2, 'hand_result', ['5']],
		])
	})

	it('returns an empty log when the block cannot be read', () => {
		expect(decode(reduceToResultOnly('not-a-block'))).toEqual([])
	})
})
