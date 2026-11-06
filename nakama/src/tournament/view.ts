// What clients are sent: a short summary for lists, and the full view of one
// tournament with the bracket already resolved (players, scores, deadlines),
// so the Lua side never re-implements bracket logic. Pure.
import { finalPlacements, tiebreakersFor } from './engine/bracket'
import { resolveBracket } from './engine/resolve'
import { MINUTE_MS } from './engine/schedule'
import { splitGroups } from './engine/round_robin'
import { computeStandings } from './engine/standings'
import { type Role, type Tournament, isManager, roleOf, roundSettingsFor } from './model'

const EVENTS_SHOWN = 50

export interface TournamentSummary {
	id: string
	name: string
	format: Tournament['format']
	status: Tournament['status']
	visibility: Tournament['visibility']
	organiserName: string
	players: number
	maxPlayers: number
	waitlist: number
	startsAt: number
	checkInAt: number | null
	gameMode: string
	ruleset: string
	registrationOpen: boolean
	official: boolean
	requireRanked: boolean
}

export function summaryOf(t: Tournament): TournamentSummary {
	return {
		id: t.id,
		name: t.name,
		format: t.format,
		status: t.status,
		visibility: t.visibility,
		organiserName: t.organiserName,
		players: t.entrants.length,
		maxPlayers: t.maxPlayers,
		waitlist: t.waitlist.length,
		startsAt: t.startsAt,
		checkInAt: t.checkInMinutes === null ? null : t.startsAt - t.checkInMinutes * MINUTE_MS,
		gameMode: t.rounds.defaults.gameMode,
		ruleset: t.rounds.defaults.ruleset,
		registrationOpen: t.status === 'registration' && !t.registrationClosed,
		official: t.official === true,
		requireRanked: t.requireRanked === true,
	}
}

type PlayerRef = { id: string; name: string } | null | 'tbd'

function nameMap(t: Tournament): { [id: string]: string } {
	const names: { [id: string]: string } = {}
	for (const e of t.entrants.concat(t.waitlist)) names[e.userId] = e.name
	return names
}

function lobbyOf(t: Tournament, matchId: string) {
	const lobby = t.lobbies ? t.lobbies[matchId] : undefined
	if (!lobby || (lobby.status !== 'open' && lobby.status !== 'disputed')) return null
	return { code: lobby.code, game: lobby.game, status: lobby.status }
}

export function tournamentView(t: Tournament, viewerId: string, now: number) {
	const role: Role = roleOf(t, viewerId)
	const names = nameMap(t)
	const ref = (p: string | null | undefined): PlayerRef => (p === undefined ? 'tbd' : p === null ? null : { id: p, name: names[p] ?? '?' })
	const seeds = t.bracket ? t.bracket.seeds : []

	let bracket = null
	let standings = null
	let places = null
	let you: { nextMatchId: string | null; eliminated: boolean } | null = null
	if (t.bracket) {
		const resolved = resolveBracket(t.bracket, t.dropped)
		const clock = t.clock ? t.clock.matches : {}
		bracket = resolved.matches.map((m) => {
			const c = clock[m.def.id]
			const settings = roundSettingsFor(t, m.def.stage, m.def.round)
			return {
				id: m.def.id,
				stage: m.def.stage,
				round: m.def.round,
				order: m.def.order,
				group: m.def.group ?? null,
				players: [ref(m.players[0]), ref(m.players[1])],
				status: m.status,
				bestOf: m.def.bestOf,
				wins: m.wins,
				games: m.stale ? [] : m.def.games,
				outcome: m.outcome ? { winner: m.outcome.winner, draw: m.outcome.draw, reason: m.outcome.reason } : null,
				gameMode: settings.gameMode,
				ruleset: settings.ruleset,
				// The round's deck rule (locked deck + stake, or a ban-and-pick pool).
				deck: settings.deck ?? null,
				clock: c ? { phase: c.phase, deadline: c.deadline, ready: c.ready, openedAt: c.openedAt } : null,
				// The lobby for the current game (only seats its two players).
				lobby: lobbyOf(t, m.def.id),
			}
		})
		const tiebreakers = tiebreakersFor(t.bracket)
		if (t.format === 'swiss') standings = [computeStandings(seeds, resolved.matches, tiebreakers, t.dropped)]
		if (t.format === 'round_robin') {
			const groups = splitGroups(seeds, t.bracket.options.groupSize ?? seeds.length)
			standings = groups.map((members, g) =>
				computeStandings(
					members,
					resolved.matches.filter((m) => m.def.group === g + 1),
					tiebreakers,
					t.dropped,
				),
			)
		}
		places = finalPlacements(t.bracket, t.dropped)
		if (role === 'entrant' || seeds.indexOf(viewerId) !== -1) {
			const mine = resolved.matches.filter((m) => m.players[0] === viewerId || m.players[1] === viewerId)
			const next = mine.find((m) => m.status === 'ready' || m.status === 'in_progress') ?? mine.find((m) => m.status === 'waiting')
			// Round robin/Swiss placings are the standings (everyone), so only
			// elimination knocks anyone out.
			const elimination = t.format === 'single_elim' || t.format === 'double_elim'
			const out = elimination && t.status === 'running' && places.some((p) => p.id === viewerId)
			you = { nextMatchId: next ? next.def.id : null, eliminated: out || t.dropped.indexOf(viewerId) !== -1 }
		}
	}

	const manager = isManager(t, viewerId)
	return {
		serverNow: now,
		role,
		summary: summaryOf(t),
		description: t.description,
		organiserId: t.organiserId,
		coOrganiserIds: t.coOrganiserIds,
		coOrganisers: t.coOrganiserIds.map((id) => ({ id, name: (t.coOrganiserNames && t.coOrganiserNames[id]) || '?' })),
		// Only the organiser shares it.
		coOrganiserCode: t.organiserId === viewerId ? t.coOrganiserCode ?? null : undefined,
		inviteCode: manager ? t.inviteCode : undefined,
		formatOptions: t.formatOptions,
		seeding: { kind: t.seeding.kind, board: t.seeding.board ?? `ranked:${t.rounds.defaults.ruleset}` },
		rounds: t.rounds,
		timetable: t.timetable,
		schedule: t.schedule ?? null,
		blocks: t.clock ? t.clock.blocks : null,
		paused: t.clock ? t.clock.pausedSince !== undefined : false,
		entrants: t.entrants.map((e) => ({
			id: e.userId,
			name: e.name,
			seed: seeds.indexOf(e.userId) === -1 ? null : seeds.indexOf(e.userId) + 1,
			checkedIn: e.checkedInAt !== undefined,
			dropped: t.dropped.indexOf(e.userId) !== -1,
			rating: manager ? (e.rating ?? null) : undefined,
		})),
		waitlist: t.waitlist.map((e) => ({ id: e.userId, name: e.name })),
		bracket,
		standings,
		placements: places,
		you,
		events: t.events.slice(-EVENTS_SHOWN),
		startedAt: t.startedAt ?? null,
		finishedAt: t.finishedAt ?? null,
	}
}
