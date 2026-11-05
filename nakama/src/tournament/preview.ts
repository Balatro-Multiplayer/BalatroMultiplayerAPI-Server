// A pretend run of a tournament the organiser is still setting up: their
// settings, `players` dummy players ("Player 1" is the top seed), and made-up
// results up to a round, so the create wizard can show the bracket each round
// at a time. Built with the real engine, so it matches what will happen.
// Nothing is saved. Pure.
import { type Result, err, ok } from '../shared/result'
import { MAX_ENTRANTS, MIN_ENTRANTS, nextSwissRound, recordGame, swissRoundsPlayed } from './engine/bracket'
import { resolveBracket } from './engine/resolve'
import { roundSteps } from './engine/schedule'
import { type Rng, seededRng } from './engine/seeding'
import type { Bracket, Side } from './engine/types'
import { createTournament, joinTournament, openRegistration, start } from './lifecycle'
import { type Input, type Tournament, roundSettingsFor } from './model'
import { tournamentView } from './view'

const ORGANISER = { id: 'preview-organiser', name: 'Organiser' }
const MINUTE_MS = 60 * 1000
// How often the better seed wins a game (the rest is an upset).
const FAVOURITE_WINS = 0.7
// A match is decided within this many games (best of 7, with draws to spare).
const MAX_GAMES = 16

export const previewPlayerId = (n: number) => `preview-${n}`

// Plays every match of rounds 1..upTo, game by game.
function simulate(t: Tournament, upTo: number, rng: Rng): Bracket {
	let bracket = t.bracket as Bracket
	for (let s = 1; s <= upTo; s++) {
		if (bracket.format === 'swiss' && swissRoundsPlayed(bracket) < s) {
			const paired = nextSwissRound(bracket, [], roundSettingsFor(t, 'SW', s, bracket).bestOf)
			if (!paired.ok) break
			bracket = paired.value
		}
		const step = roundSteps(bracket)[s - 1]
		if (!step) break
		const inStep = (stage: string, round: number) => step.some((r) => r.stage === stage && r.round === round)
		for (let game = 0; game < MAX_GAMES; game++) {
			const open = resolveBracket(bracket, []).matches.filter((m) => inStep(m.def.stage, m.def.round) && (m.status === 'ready' || m.status === 'in_progress'))
			if (open.length === 0) break
			for (const m of open) {
				const [a, b] = m.players as [string, string]
				const favourite: Side = bracket.seeds.indexOf(a) <= bracket.seeds.indexOf(b) ? 0 : 1
				const winner: Side = rng() < FAVOURITE_WINS ? favourite : ((1 - favourite) as Side)
				const r = recordGame(bracket, m.def.id, winner, [])
				if (r.ok) bracket = r.value
			}
		}
	}
	return bracket
}

export interface Preview {
	tournament: ReturnType<typeof tournamentView>
	// How many rounds there are, and how many have been played.
	steps: number
	step: number
}

// settings: what tournament_create takes. step: rounds to play (clamped).
export function previewTournament(settings: Input, players: number, step: number, now: number): Result<Preview, string> {
	if (!Number.isInteger(players) || players < MIN_ENTRANTS || players > MAX_ENTRANTS) return err(`players must be ${MIN_ENTRANTS}-${MAX_ENTRANTS}`)
	if (!Number.isInteger(step) || step < 0) return err('step must be 0 or more')
	// Whatever the wizard has so far: only the bracket and round settings matter.
	const input: Input = { ...settings, name: 'Preview', description: '', official: false, visibility: 'private', maxPlayers: players, startsAt: now + 60 * MINUTE_MS, checkInMinutes: null }
	const created = createTournament('preview', ORGANISER, input, 'PREVIEW', now)
	if (!created.ok) return err(created.error.message)
	const opened = openRegistration(created.value, ORGANISER.id, now)
	if (!opened.ok) return err(opened.error.message)
	let t = opened.value
	for (let n = 1; n <= players; n++) {
		const joined = joinTournament(t, { id: previewPlayerId(n), name: `Player ${n}` }, now)
		if (!joined.ok) return err(joined.error.message)
		t = joined.value
	}
	// Player 1 has the best rating; with random seeding the shuffle is fixed.
	const ratings = (ids: string[]) => {
		const out: { [id: string]: number } = {}
		for (const id of ids) out[id] = 3000 - Number(id.slice('preview-'.length))
		return out
	}
	const started = start(t, now, ratings, seededRng(players))
	if (!started.ok) return err(started.error.message)
	t = started.value
	const steps = roundSteps(t.bracket as Bracket).length
	const played = Math.min(step, steps)
	const bracket = simulate(t, played, seededRng(1000 + players))
	// No clock or lobbies: the viewer shows results only.
	const shown: Tournament = { ...t, bracket, clock: undefined, schedule: undefined, lobbies: undefined }
	return ok({ tournament: tournamentView(shown, ORGANISER.id, now), steps, step: played })
}
