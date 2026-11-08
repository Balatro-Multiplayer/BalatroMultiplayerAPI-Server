// Almanac's in-run deck draft. One shared offer and two independent picks at
// each milestone. The ledger survives disconnects, host migration and restarts;
// clients never supply offers or their acquisition history.
import { ServerOp } from './protocol'
import type { Lobby, Outbound, Step } from './state'

export const ALMANAC_RULESET = 'ruleset_mp_almanac'
export const ALMANAC_RANKED_MODE = 'pvp_ranked_almanac'
export const DECK_ANTES: { [key: string]: number } = {
	b_red: 2,
	b_blue: 2,
	b_yellow: 2,
	b_green: 2,
	b_black: 3,
	b_magic: 2,
	b_nebula: 2,
	b_ghost: 3,
	b_abandoned: 3,
	b_checkered: 3,
	b_zodiac: 2,
	b_painted: 3,
	b_anaglyph: 2,
	b_erratic: 2,
	b_mp_violet: 2,
	b_mp_indigo: 5,
	b_mp_orange: 2,
	b_mp_oracle: 5,
	b_mp_gradient: 5,
	b_mp_heidelberg: 7,
	b_mp_echodeck: 7,
}
const MILESTONES = [2, 3, 5, 7]

export interface DeckOffer {
	id: string
	ante: number
	choices: string[]
	picks: { [player: string]: string }
}
export interface Almanac {
	run: string
	players: string[]
	acquired: { [player: string]: string[] }
	offers: { [ante: string]: DeckOffer }
}

export function isAlmanac(lobby: Lobby): boolean {
	return (
		lobby.modId === 'MultiplayerPvP' &&
		(lobby.rankedMode === ALMANAC_RANKED_MODE ||
			(!lobby.rankedMode &&
				!lobby.gameMode &&
				(lobby.metadata.ruleset === ALMANAC_RULESET ||
					lobby.metadata.deck === 'Almanac')))
	)
}

function view(lobby: Lobby, offer: DeckOffer, player: string): Outbound {
	return {
		kind: 'send',
		op: ServerOp.ACTION,
		to: [player],
		payload: {
			cid: '',
			action: 'pvp_almanac_offer',
			from: lobby.hostId,
			to: '*',
			params: {
				id: offer.id,
				ante: offer.ante,
				choices: offer.choices,
				picked: offer.picks[player],
			},
		},
	}
}

export function almanacAction(
	lobby: Lobby,
	from: string,
	key: string,
	input: unknown,
): Step | null {
	if (
		!['pvp_almanac_open', 'pvp_almanac_pick', 'pvp_almanac_offer'].includes(key)
	)
		return null
	const refuse = (reason: string): Step => ({
		lobby,
		out: [
			{
				kind: 'send',
				op: ServerOp.ACTION_REJECTED,
				to: [from],
				payload: { action: key, reason },
			},
		],
	})
	if (key === 'pvp_almanac_offer') return refuse('server_only')
	const started = lobby.game.started
	if (
		!isAlmanac(lobby) ||
		!started ||
		started.players.length !== 2 ||
		lobby.players.length !== 2 ||
		!started.players.some((p) => p.id === from)
	)
		return refuse('unavailable')
	const params =
		input && typeof input === 'object' && !Array.isArray(input)
			? (input as { [key: string]: unknown })
			: {}
	const ante = params.ante
	if (typeof ante !== 'number' || !MILESTONES.includes(ante))
		return refuse('bad_ante')
	const players = started.players.map((p) => p.id).sort()
	const current: Almanac =
		lobby.almanac?.run === started.runId
			? lobby.almanac
			: {
					run: started.runId,
					players,
					acquired: { [players[0]]: [], [players[1]]: [] },
					offers: {},
				}
	const existing = current.offers[ante]
	if (key === 'pvp_almanac_open') {
		if (existing) return { lobby, out: [view(lobby, existing, from)] }
		const previous = MILESTONES[MILESTONES.indexOf(ante) - 1]
		if (previous && !players.every((p) => !!current.offers[previous]?.picks[p]))
			return refuse('previous_pending')
		const pool = Object.keys(DECK_ANTES)
			.filter(
				(deck) =>
					DECK_ANTES[deck] <= ante &&
					players.every((p) => !current.acquired[p].includes(deck)),
			)
			.sort()
		let rng = 1
		const id = `${started.runId}:decks:${ante}`
		for (let i = 0; i < id.length; i++)
			rng = (rng * 31 + id.charCodeAt(i)) % 2147483647
		const choices: string[] = []
		while (choices.length < 3 && pool.length > 0) {
			rng = (rng * 16807) % 2147483647
			choices.push(pool.splice(rng % pool.length, 1)[0])
		}
		const offer: DeckOffer = { id, ante, choices, picks: {} }
		const next = {
			...lobby,
			almanac: { ...current, offers: { ...current.offers, [ante]: offer } },
		}
		return { lobby: next, out: [view(next, offer, from)] }
	}
	if (!existing || params.id !== existing.id) return refuse('stale_offer')
	// A retransmitted selection returns the original commitment, never changes it.
	if (existing.picks[from]) return { lobby, out: [view(lobby, existing, from)] }
	if (
		typeof params.deck !== 'string' ||
		!existing.choices.includes(params.deck)
	)
		return refuse('not_offered')
	const offer = {
		...existing,
		picks: { ...existing.picks, [from]: params.deck },
	}
	const state: Almanac = {
		...current,
		offers: { ...current.offers, [ante]: offer },
		acquired: {
			...current.acquired,
			[from]: [...current.acquired[from], params.deck],
		},
	}
	const next = { ...lobby, almanac: state }
	return { lobby: next, out: [view(next, offer, from)] }
}
