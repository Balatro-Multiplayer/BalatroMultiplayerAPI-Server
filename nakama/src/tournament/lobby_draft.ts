// Who bans first in a tournament lobby's Draft, from the round's ban order.
// The lobby's server code rolls the first actor at random
// (actions/setup.ts startDraft); a tournament lobby carries this instead,
// so the host's game can't choose:
//   lower_seed_first      the lower seed (worse seed number) bans first
//   lower_seed_last       the higher seed bans first
//   previous_loser_first  game 1 random, then the last game's loser
//   random                the lobby rolls, as for any lobby
// Pure.
import type { Placement } from '../lobby/protocol'
import type { RoundSettings, TournamentLobbyRef } from './model'

export type LobbyDraftOrder = NonNullable<TournamentLobbyRef['draft']>

// The order for a match's lobby. seeds: the bracket's seeds, best first.
export function draftOrderFor(settings: RoundSettings, seeds: string[], players: [string, string]): LobbyDraftOrder | undefined {
	const deck = settings.deck
	if (!deck || deck.kind !== 'draft') return undefined
	const seed = (id: string) => {
		const i = seeds.indexOf(id)
		return i === -1 ? Number.MAX_SAFE_INTEGER : i
	}
	const [better, worse] = seed(players[0]) <= seed(players[1]) ? players : [players[1], players[0]]
	if (deck.banOrder === 'lower_seed_first') return { first: worse }
	if (deck.banOrder === 'lower_seed_last') return { first: better }
	if (deck.banOrder === 'previous_loser_first') return { loserFirst: true }
	return undefined
}

// After a game: with "previous loser first", its loser bans first next.
export function afterTournamentGame(ref: TournamentLobbyRef, placements: Placement[]): TournamentLobbyRef {
	if (!ref.draft || !ref.draft.loserFirst || placements.length < 2) return ref
	let loser: Placement | null = null
	for (const p of placements) if (!loser || p.place > loser.place) loser = p
	const best = Math.min(...placements.map((p) => p.place))
	// A draw (everyone placed the same) leaves the order as it was.
	if (!loser || loser.place === best) return ref
	return { ...ref, draft: { ...ref.draft, first: loser.playerId } }
}

// A lobby's tournament reference from its match parameters (JSON), with the
// ban order; undefined when it isn't one.
export function parseLobbyRef(value: unknown): TournamentLobbyRef | undefined {
	if (!value || typeof value !== 'object') return undefined
	const { tournamentId, matchId, draft } = value as { [key: string]: unknown }
	if (typeof tournamentId !== 'string' || typeof matchId !== 'string') return undefined
	const ref: TournamentLobbyRef = { tournamentId, matchId }
	if (draft && typeof draft === 'object') {
		const d = draft as { [key: string]: unknown }
		const order: LobbyDraftOrder = {}
		if (typeof d.first === 'string') order.first = d.first
		if (d.loserFirst === true) order.loserFirst = true
		if (order.first !== undefined || order.loserFirst) ref.draft = order
	}
	return ref
}

// The index into the Draft's turn order to start from, or null to roll.
export function draftFirstIndex(ref: TournamentLobbyRef | undefined, order: string[]): number | null {
	const first = ref && ref.draft ? ref.draft.first : undefined
	if (!first) return null
	const i = order.indexOf(first)
	return i === -1 ? null : i
}
