// A tournament as stored (one system-owned object per tournament) and the
// checks on what an organiser sends. Pure.
import { type Result, err, ok } from '../shared/result'
import { BEST_OF_CHOICES, MAX_ENTRANTS, MIN_ENTRANTS } from './engine/bracket'
import type { Preset, ScheduleBlock, TimetableState } from './engine/schedule'
import type { Bracket, Format } from './engine/types'

export const TOURNAMENT_MOD_ID = 'MultiplayerPvP'

// Fake entrants added by the Dev-server fill (dev.ts). They have no account:
// no notifications, no player list; they ready up and play by themselves.
export const FAKE_ENTRANT_PREFIX = 'dev-bot-'

export function isFakeEntrant(id: string): boolean {
	return id.indexOf(FAKE_ENTRANT_PREFIX) === 0
}

export type TournamentStatus = 'draft' | 'registration' | 'check_in' | 'running' | 'finished' | 'cancelled'

export type Role = 'organiser' | 'co_organiser' | 'entrant' | 'waitlist' | 'none'

export interface Entrant {
	userId: string
	name: string
	joinedAt: number
	checkedInAt?: number
	// Rating on the seeding board, read when the tournament starts.
	rating?: number | null
}

// What the organiser picks per round; `lobbyOptions` is the PvP mod's own
// settings, kept as-is (PvP validates them).
export interface RoundSettings {
	gameMode: string
	ruleset: string
	bestOf: number
	// Deck + stake: locked to one pair, or drafted from a pool with a ban order.
	deck?:
		| { kind: 'locked'; deck: string; stake: number }
		| { kind: 'draft'; decks: string[]; stakes: number[]; banOrder: BanOrder }
	lobbyOptions?: { [key: string]: unknown }
}

export type BanOrder = 'lower_seed_first' | 'lower_seed_last' | 'random' | 'previous_loser_first'

export type Timetable = { kind: 'preset'; preset: Preset; options: PresetOptions } | { kind: 'custom'; blocks: ScheduleBlock[] }

export interface PresetOptions {
	breakMinutes?: number
	readyUpMinutes?: number
	roundStarts?: number[]
	windowMinutes?: number
	seriesReadyUpMinutes?: number
	fallbackAfterHours?: number
	fallback?: 'higher_seed' | 'both_lose'
}

export interface TournamentEvent {
	at: number
	kind: string
	// Increases by one per event (Tournament.eventSeq): what is new since a
	// save, so each notification goes out once.
	seq?: number
	[key: string]: unknown
}

export interface Tournament {
	id: string
	schema: 1
	modId: string
	name: string
	description: string
	organiserId: string
	organiserName: string
	coOrganiserIds: string[]
	visibility: 'public' | 'private'
	// Run by the game's own organisers: highlighted in the client. Only players
	// with the OFFICIAL_PRIVILEGE may create or set it (rpc.ts checks).
	official?: boolean
	inviteCode: string
	format: Format
	formatOptions: { grandFinalReset?: boolean; groupSize?: number; swissRounds?: number }
	maxPlayers: number
	startsAt: number
	// Minutes before the start that check-in opens; null = no check-in.
	checkInMinutes: number | null
	seeding: { kind: 'rating' | 'random' | 'manual'; board?: string; order?: string[] }
	rounds: { defaults: RoundSettings; overrides: { [round: string]: Partial<RoundSettings> } }
	timetable: Timetable
	status: TournamentStatus
	registrationClosed: boolean
	entrants: Entrant[]
	waitlist: Entrant[]
	dropped: string[]
	bracket?: Bracket
	schedule?: ScheduleBlock[]
	clock?: TimetableState
	// When the timetable next needs a tick (from the engine).
	nextWakeAt?: number | null
	// The lobby made for each match's current game (effects.ts).
	lobbies?: { [matchId: string]: TournamentLobby }
	// The last event's seq.
	eventSeq?: number
	// Recent happenings, newest last (capped): what Phase 3 notifies about and
	// what the client's activity view shows.
	events: TournamentEvent[]
	createdAt: number
	updatedAt: number
	startedAt?: number
	finishedAt?: number
	// Dev servers only: how far this tournament's clock runs ahead.
	devClockOffsetMs?: number
}

// The PvP lobby a match is played in: one per match, reused for every game
// of a series, closed by the server once the match is decided (players are
// sent back to the tournament). `handoff` is the timetable hand-off
// (MatchClock.handoff) of the game it is playing now: a stored run only
// counts when its lobby code and that hand-off are current.
export interface TournamentLobby {
	code: string
	game: number
	handoff: number
	// creating: claimed, being made. open: live (between or during games).
	// disputed: a game's result waits for an organiser. lost: vanished
	// mid-game. closed: closed by the server after the match.
	status: 'creating' | 'open' | 'disputed' | 'lost' | 'closed'
	createdAt: number
	runId?: string
}

// What a tournament lobby carries (Lobby.tournament), and hands back with
// its results.
export interface TournamentLobbyRef {
	tournamentId: string
	matchId: string
}

// The privilege (Profile.privileges, set by the web admin or admin_profile_set)
// that lets a player create official tournaments.
export const OFFICIAL_PRIVILEGE = 'tournament_official'

export const NAME_MAX = 48
export const DESCRIPTION_MAX = 500
export const CO_ORGANISERS_MAX = 5
export const EVENTS_KEPT = 200
const KEY_PATTERN = /^[A-Za-z0-9_:.-]{1,64}$/
const ROUND_KEY_PATTERN = /^(W|L|GF|RR|SW)[0-9]{1,3}$/
const LOBBY_OPTIONS_MAX_BYTES = 4096
const MIN_LEAD_MS = 5 * 60 * 1000
const MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000

export type Input = { [key: string]: unknown }

function isInputObject(v: unknown): v is Input {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function int(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v)
}

export function validRoundSettings(value: unknown, partial: boolean): Result<Partial<RoundSettings>, string> {
	if (!isInputObject(value)) return err('Round settings must be an object')
	const out: Partial<RoundSettings> = {}
	for (const key of ['gameMode', 'ruleset'] as const) {
		const v = value[key]
		if (v === undefined && partial) continue
		if (typeof v !== 'string' || !KEY_PATTERN.test(v)) return err(`${key} is required`)
		out[key] = v
	}
	if (value.bestOf !== undefined || !partial) {
		if (!int(value.bestOf) || BEST_OF_CHOICES.indexOf(value.bestOf) === -1) return err('bestOf must be 1, 3, 5 or 7')
		out.bestOf = value.bestOf
	}
	const deck = value.deck
	if (deck !== undefined && deck !== null) {
		if (!isInputObject(deck)) return err('deck must be an object')
		if (deck.kind === 'locked') {
			if (typeof deck.deck !== 'string' || !KEY_PATTERN.test(deck.deck) || !int(deck.stake) || deck.stake < 1 || deck.stake > 8) {
				return err('A locked deck needs a deck key and a stake from 1 to 8')
			}
			out.deck = { kind: 'locked', deck: deck.deck, stake: deck.stake }
		} else if (deck.kind === 'draft') {
			const decks = deck.decks
			const stakes = deck.stakes
			if (!Array.isArray(decks) || decks.length < 1 || decks.length > 64 || !decks.every((d) => typeof d === 'string' && KEY_PATTERN.test(d))) {
				return err('A draft needs 1-64 deck keys')
			}
			if (!Array.isArray(stakes) || stakes.length < 1 || !stakes.every((s) => int(s) && s >= 1 && s <= 8)) {
				return err('A draft needs stakes from 1 to 8')
			}
			const orders: BanOrder[] = ['lower_seed_first', 'lower_seed_last', 'random', 'previous_loser_first']
			if (orders.indexOf(deck.banOrder as BanOrder) === -1) return err('Unknown ban order')
			out.deck = { kind: 'draft', decks: decks as string[], stakes: stakes as number[], banOrder: deck.banOrder as BanOrder }
		} else return err('deck.kind must be locked or draft')
	}
	if (value.lobbyOptions !== undefined) {
		if (!isInputObject(value.lobbyOptions)) return err('lobbyOptions must be an object')
		if (JSON.stringify(value.lobbyOptions).length > LOBBY_OPTIONS_MAX_BYTES) return err('lobbyOptions is too large')
		out.lobbyOptions = value.lobbyOptions
	}
	return ok(out)
}

function validPresetOptions(value: unknown): Result<PresetOptions, string> {
	if (value === undefined) return ok({})
	if (!isInputObject(value)) return err('Timetable options must be an object')
	const out: PresetOptions = {}
	const minutes = (key: 'breakMinutes' | 'readyUpMinutes' | 'windowMinutes' | 'seriesReadyUpMinutes', min: number, max: number) => {
		const v = value[key]
		if (v === undefined) return null
		if (!int(v) || v < min || v > max) return `${key} must be ${min}-${max}`
		out[key] = v
		return null
	}
	const problem =
		minutes('breakMinutes', 0, 7 * 24 * 60) ||
		minutes('readyUpMinutes', 2, 30) ||
		minutes('seriesReadyUpMinutes', 2, 30) ||
		minutes('windowMinutes', 10, 30 * 24 * 60)
	if (problem) return err(problem)
	if (value.roundStarts !== undefined) {
		if (!Array.isArray(value.roundStarts) || value.roundStarts.length > 64 || !value.roundStarts.every(int)) return err('roundStarts must be times')
		out.roundStarts = value.roundStarts as number[]
	}
	if (value.fallbackAfterHours !== undefined) {
		if (typeof value.fallbackAfterHours !== 'number' || value.fallbackAfterHours < 0 || value.fallbackAfterHours > 12) return err('fallbackAfterHours must be 0-12')
		out.fallbackAfterHours = value.fallbackAfterHours
	}
	if (value.fallback !== undefined) {
		if (value.fallback !== 'higher_seed' && value.fallback !== 'both_lose') return err('fallback must be higher_seed or both_lose')
		out.fallback = value.fallback
	}
	return ok(out)
}

function validTimetable(value: unknown): Result<Timetable, string> {
	if (!isInputObject(value)) return err('timetable is required')
	if (value.kind === 'preset') {
		const presets: Preset[] = ['live_event', 'live_fixed_rounds', 'league']
		if (presets.indexOf(value.preset as Preset) === -1) return err('Unknown timetable preset')
		const options = validPresetOptions(value.options)
		if (!options.ok) return options
		return ok({ kind: 'preset', preset: value.preset as Preset, options: options.value })
	}
	if (value.kind === 'custom') {
		// Shape only: the blocks are checked against the real bracket at start
		// (the number of rounds depends on who shows up).
		if (!Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 64) return err('A custom timetable needs 1-64 blocks')
		if (JSON.stringify(value.blocks).length > 16384) return err('The timetable is too large')
		return ok({ kind: 'custom', blocks: value.blocks as ScheduleBlock[] })
	}
	return err('timetable.kind must be preset or custom')
}

// The editable settings, from a create (everything required) or an update
// (only what is sent). Returns the fields to apply.
export function validSettings(input: Input, now: number, partial: boolean): Result<Partial<Tournament>, string> {
	const out: Partial<Tournament> = {}
	const has = (key: string) => input[key] !== undefined
	if (has('name') || !partial) {
		const name = typeof input.name === 'string' ? input.name.trim() : ''
		if (name.length < 3 || name.length > NAME_MAX) return err(`name must be 3-${NAME_MAX} characters`)
		out.name = name
	}
	if (has('description')) {
		if (typeof input.description !== 'string' || input.description.length > DESCRIPTION_MAX) return err(`description must be at most ${DESCRIPTION_MAX} characters`)
		out.description = input.description
	} else if (!partial) out.description = ''
	if (has('official') || !partial) {
		const official = input.official ?? false
		if (typeof official !== 'boolean') return err('official must be true or false')
		out.official = official
	}
	if (has('visibility') || !partial) {
		const v = input.visibility ?? 'public'
		if (v !== 'public' && v !== 'private') return err('visibility must be public or private')
		out.visibility = v
	}
	if (has('format') || !partial) {
		const formats: Format[] = ['single_elim', 'double_elim', 'round_robin', 'swiss']
		if (formats.indexOf(input.format as Format) === -1) return err('Unknown format')
		out.format = input.format as Format
	}
	if (has('formatOptions')) {
		const fo = input.formatOptions
		if (!isInputObject(fo)) return err('formatOptions must be an object')
		const options: Tournament['formatOptions'] = {}
		if (fo.grandFinalReset !== undefined) {
			if (typeof fo.grandFinalReset !== 'boolean') return err('grandFinalReset must be true or false')
			options.grandFinalReset = fo.grandFinalReset
		}
		if (fo.groupSize !== undefined) {
			if (!int(fo.groupSize) || fo.groupSize < 2 || fo.groupSize > MAX_ENTRANTS) return err('groupSize must be 2 or more')
			options.groupSize = fo.groupSize
		}
		if (fo.swissRounds !== undefined) {
			if (!int(fo.swissRounds) || fo.swissRounds < 1 || fo.swissRounds > 20) return err('swissRounds must be 1-20')
			options.swissRounds = fo.swissRounds
		}
		out.formatOptions = options
	} else if (!partial) out.formatOptions = {}
	if (has('maxPlayers') || !partial) {
		if (!int(input.maxPlayers) || input.maxPlayers < MIN_ENTRANTS || input.maxPlayers > MAX_ENTRANTS) return err(`maxPlayers must be ${MIN_ENTRANTS}-${MAX_ENTRANTS}`)
		out.maxPlayers = input.maxPlayers
	}
	if (has('startsAt') || !partial) {
		if (!int(input.startsAt) || input.startsAt < now + MIN_LEAD_MS || input.startsAt > now + MAX_LEAD_MS) {
			return err('startsAt must be at least 5 minutes and at most 90 days away')
		}
		out.startsAt = input.startsAt
	}
	if (has('checkInMinutes') || !partial) {
		const c = input.checkInMinutes ?? null
		if (c !== null && (!int(c) || c < 10 || c > 60)) return err('checkInMinutes must be 10-60, or null for no check-in')
		out.checkInMinutes = c as number | null
	}
	if (has('seeding') || !partial) {
		const s = input.seeding ?? { kind: 'rating' }
		if (!isInputObject(s) || ['rating', 'random', 'manual'].indexOf(s.kind as string) === -1) return err('seeding.kind must be rating, random or manual')
		if (s.board !== undefined && (typeof s.board !== 'string' || !KEY_PATTERN.test(s.board))) return err('seeding.board is not a board key')
		out.seeding = { kind: s.kind as 'rating' | 'random' | 'manual', board: s.board as string | undefined }
	}
	if (has('rounds') || !partial) {
		const r = input.rounds
		if (!isInputObject(r)) return err('rounds is required')
		const defaults = validRoundSettings(r.defaults, false)
		if (!defaults.ok) return err(`rounds.defaults: ${defaults.error}`)
		const overrides: { [round: string]: Partial<RoundSettings> } = {}
		if (r.overrides !== undefined) {
			if (!isInputObject(r.overrides)) return err('rounds.overrides must be an object')
			for (const key of Object.keys(r.overrides)) {
				if (!ROUND_KEY_PATTERN.test(key)) return err(`Unknown round ${key}`)
				const o = validRoundSettings(r.overrides[key], true)
				if (!o.ok) return err(`rounds.overrides.${key}: ${o.error}`)
				overrides[key] = o.value
			}
		}
		out.rounds = { defaults: defaults.value as RoundSettings, overrides }
	}
	if (has('timetable') || !partial) {
		const t = validTimetable(input.timetable)
		if (!t.ok) return t
		out.timetable = t.value
	}
	return ok(out)
}

// The round settings that apply to one round (defaults + its override).
export function roundSettingsFor(t: Tournament, stage: string, round: number): RoundSettings {
	return { ...t.rounds.defaults, ...(t.rounds.overrides[`${stage}${round}`] ?? {}) } as RoundSettings
}

// The tournament's own "now": real time plus a Dev-server clock skip.
export function nowFor(t: Tournament, real: number): number {
	return real + (t.devClockOffsetMs ?? 0)
}

export function roleOf(t: Tournament, userId: string): Role {
	if (t.organiserId === userId) return 'organiser'
	if (t.coOrganiserIds.indexOf(userId) !== -1) return 'co_organiser'
	if (t.entrants.some((e) => e.userId === userId)) return 'entrant'
	if (t.waitlist.some((e) => e.userId === userId)) return 'waitlist'
	return 'none'
}

export function isManager(t: Tournament, userId: string): boolean {
	const role = roleOf(t, userId)
	return role === 'organiser' || role === 'co_organiser'
}

export function addEvent(t: Tournament, event: TournamentEvent): Tournament {
	const seq = (t.eventSeq ?? 0) + 1
	const events = t.events.concat([{ ...event, seq }])
	return { ...t, eventSeq: seq, events: events.length > EVENTS_KEPT ? events.slice(events.length - EVENTS_KEPT) : events }
}
