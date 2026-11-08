// Round-by-round changes to a preset timetable: a break before a round, a
// round the organiser starts by hand or one that continues at a set date and
// time, or another way of playing (live with a
// ready-up, or by a deadline), for one round or "this round and every later
// one". Keyed like round settings (model.ts): R<n> (the n-th round played)
// and named rounds (FINAL, SEMI...). Applied when the tournament starts, to
// the preset's blocks for the real bracket: a block is split only where a
// round changes something, so no changes means the preset as it was. Pure.
import { type Result, err, ok } from '../shared/result'
import { type PlayRule, type ScheduleBlock, type StartRule, roundSteps } from './engine/schedule'
import type { Bracket } from './engine/types'
import { type Input, roundNamesOf } from './model'

export interface RoundTiming {
	// Minutes to wait after the earlier rounds have finished (not round 1).
	breakBefore?: number
	// The organiser starts it (START ROUND).
	manualStart?: boolean
	// It continues at this time (epoch ms), after a long break.
	startAt?: number
	// With startAt: its players check in this many minutes before (10-60).
	checkInMinutes?: number
	play?: { kind: 'live'; readyUpMinutes: number } | { kind: 'window'; durationMinutes: number }
	// Also every later round (until another change takes over).
	onward?: boolean
}

export const ROUND_TIMING_KEY = /^(R[0-9]{1,3}|FINAL|SEMI|QUARTER|WINNERS_FINAL|LOSERS_FINAL)$/
const BREAK_MAX = 7 * 24 * 60
const WINDOW_MAX = 30 * 24 * 60

function isObject(v: unknown): v is Input {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validRoundTimings(value: unknown): Result<{ [key: string]: RoundTiming }, string> {
	if (!isObject(value)) return err('timetable.rounds must be an object')
	const out: { [key: string]: RoundTiming } = {}
	for (const key of Object.keys(value)) {
		if (!ROUND_TIMING_KEY.test(key)) return err(`timetable.rounds: unknown round ${key}`)
		const v = value[key]
		if (!isObject(v)) return err(`timetable.rounds.${key} must be an object`)
		const t: RoundTiming = {}
		if (v.breakBefore !== undefined) {
			if (typeof v.breakBefore !== 'number' || !Number.isInteger(v.breakBefore) || v.breakBefore < 0 || v.breakBefore > BREAK_MAX) return err(`timetable.rounds.${key}: breakBefore must be 0-${BREAK_MAX} minutes`)
			t.breakBefore = v.breakBefore
		}
		if (v.manualStart !== undefined) {
			if (typeof v.manualStart !== 'boolean') return err(`timetable.rounds.${key}: manualStart must be true or false`)
			t.manualStart = v.manualStart
		}
		if (v.startAt !== undefined) {
			if (typeof v.startAt !== 'number' || !Number.isInteger(v.startAt) || v.startAt <= 0) return err(`timetable.rounds.${key}: startAt must be a time`)
			t.startAt = v.startAt
		}
		if (v.checkInMinutes !== undefined && v.checkInMinutes !== false && v.checkInMinutes !== null) {
			if (t.startAt === undefined) return err(`timetable.rounds.${key}: checkInMinutes needs startAt`)
			if (typeof v.checkInMinutes !== 'number' || !Number.isInteger(v.checkInMinutes) || v.checkInMinutes < 10 || v.checkInMinutes > 60) return err(`timetable.rounds.${key}: checkInMinutes must be 10-60`)
			t.checkInMinutes = v.checkInMinutes
		}
		if (v.onward !== undefined) {
			if (typeof v.onward !== 'boolean') return err(`timetable.rounds.${key}: onward must be true or false`)
			t.onward = v.onward
		}
		if (v.play !== undefined) {
			const p = v.play
			if (!isObject(p)) return err(`timetable.rounds.${key}.play must be an object`)
			if (p.kind === 'live') {
				if (typeof p.readyUpMinutes !== 'number' || !Number.isInteger(p.readyUpMinutes) || p.readyUpMinutes < 2 || p.readyUpMinutes > 30) return err(`timetable.rounds.${key}: readyUpMinutes must be 2-30`)
				t.play = { kind: 'live', readyUpMinutes: p.readyUpMinutes }
			} else if (p.kind === 'window') {
				if (typeof p.durationMinutes !== 'number' || !Number.isInteger(p.durationMinutes) || p.durationMinutes < 10 || p.durationMinutes > WINDOW_MAX) return err(`timetable.rounds.${key}: durationMinutes must be 10-${WINDOW_MAX}`)
				t.play = { kind: 'window', durationMinutes: p.durationMinutes }
			} else return err(`timetable.rounds.${key}.play.kind must be live or window`)
		}
		out[key] = t
	}
	return ok(out)
}

// What a round's block looks like before blocks are merged back.
interface StepBlock {
	origin: number
	changed: boolean
	block: ScheduleBlock
}

function sameRule(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

function merged(a: RoundTiming, b: RoundTiming): RoundTiming {
	return { ...a, ...b }
}

// The preset's blocks with the round changes applied.
export function applyRoundTimings(bracket: Bracket, blocks: ScheduleBlock[], timings: { [key: string]: RoundTiming } | undefined): ScheduleBlock[] {
	if (!timings || Object.keys(timings).length === 0) return blocks
	const steps = roundSteps(bracket)
	// One entry per round, from the block it was in.
	const perStep: StepBlock[] = []
	let b = 0
	let first = 1
	for (let s = 1; s <= steps.length; s++) {
		while (b < blocks.length - 1 && s > blocks[b].untilStep) {
			first = blocks[b].untilStep + 1
			b++
		}
		const start: StartRule = s === first ? blocks[b].start : { kind: 'after_previous', breakMinutes: 0 }
		perStep.push({ origin: b, changed: false, block: { ...blocks[b], untilStep: s, start } })
	}
	// Apply the changes in playing order; "onward" ones carry forward.
	let carried: RoundTiming = {}
	let carrying = false
	// A name can cover more than one round (the grand final and its reset):
	// its break or manual start goes before the first of them only.
	const namesSeen: string[] = []
	for (let s = 1; s <= steps.length; s++) {
		const names: string[] = []
		for (const r of steps[s - 1]) for (const n of roundNamesOf(bracket, r.stage, r.round)) if (names.indexOf(n) === -1) names.push(n)
		let here: RoundTiming = carrying ? { ...carried } : {}
		let touched = carrying
		for (const key of [`R${s}`].concat(names)) {
			const t = timings[key]
			if (!t) continue
			touched = true
			// "Onward" carries the way of playing; a break or a manual start
			// stays with the round it is set on.
			if (t.onward && t.play) {
				carried = merged(carried, { play: t.play })
				carrying = true
			}
			const repeat = namesSeen.indexOf(key) !== -1
			here = merged(here, repeat ? (t.play ? { play: t.play } : {}) : t)
		}
		for (const n of names) if (namesSeen.indexOf(n) === -1) namesSeen.push(n)
		if (!touched) continue
		const entry = perStep[s - 1]
		const block = { ...entry.block }
		if (here.play) {
			const play: PlayRule = here.play.kind === 'live' ? { kind: 'live', readyUpMinutes: here.play.readyUpMinutes } : { kind: 'window', durationMinutes: here.play.durationMinutes }
			if (!sameRule(play, block.play)) {
				block.play = play
				// A deadline round opens all its matches together.
				if (play.kind === 'window') block.opening = 'synchronized'
				entry.changed = true
			}
		}
		if (s > 1 && here.startAt !== undefined) {
			block.start = { kind: 'at', at: here.startAt }
			if (here.checkInMinutes !== undefined) block.checkInMinutes = here.checkInMinutes
			else delete block.checkInMinutes
			entry.changed = true
		} else if (s > 1 && here.manualStart) {
			block.start = { kind: 'manual' }
			entry.changed = true
		} else if (s > 1 && here.breakBefore !== undefined && here.breakBefore > 0) {
			block.start = { kind: 'after_previous', breakMinutes: here.breakBefore }
			entry.changed = true
		}
		entry.block = block
	}
	// Merge each round back into the block before it when nothing set them apart.
	const out: ScheduleBlock[] = []
	let last: StepBlock | null = null
	for (const entry of perStep) {
		const joins =
			last !== null &&
			last.origin === entry.origin &&
			entry.block.start.kind === 'after_previous' &&
			entry.block.start.breakMinutes === 0 &&
			sameRule(entry.block.play, out[out.length - 1].play) &&
			entry.block.opening === out[out.length - 1].opening
		if (joins) {
			out[out.length - 1] = { ...out[out.length - 1], untilStep: entry.block.untilStep }
		} else {
			out.push({ ...entry.block })
		}
		last = entry
	}
	return out
}
