// An open item's priority: higher is worked first. Set at enqueue and
// whenever something it depends on changes (another open item about the
// subject, another reporter, a sanction, a reopen).
import type { ItemType, LobbyKind } from './types.js'

export interface PriorityInput {
	itemType: ItemType
	lobbyKind: LobbyKind | undefined
	// Open items about the subject, this one included.
	openItemsForSubject: number
	// Distinct players with an open report against the subject (reports only).
	distinctReporters: number
	// Bans and warnings the subject has had before.
	priorSanctions: number
}

// By type: anti-cheat and integrity first, then reports and disputes, chat last.
export const BASE_PRIORITY: Readonly<Record<ItemType, number>> = {
	anti_cheat: 60,
	integrity: 60,
	report: 40,
	match_conflict: 40,
	// Ratings are held until it is decided.
	contest: 45,
	// A player waiting on a decision about their own punishment.
	appeal: 50,
	forfeit_reconciliation: 35,
	flagged_chat: 20,
}

const RANKED_BONUS = 15
const PRIVATE_PENALTY = 15
const PER_EXTRA_OPEN_ITEM = 5
const MAX_OPEN_ITEMS_BONUS = 20
const PER_EXTRA_REPORTER = 8
const MAX_REPORTERS_BONUS = 24
const PER_PRIOR_SANCTION = 10
const MAX_SANCTIONS_BONUS = 30

export function priorityOf(input: PriorityInput): number {
	const lobby = input.lobbyKind === 'ranked' ? RANKED_BONUS : input.lobbyKind === 'private' ? -PRIVATE_PENALTY : 0
	const openItems = Math.min(MAX_OPEN_ITEMS_BONUS, Math.max(0, input.openItemsForSubject - 1) * PER_EXTRA_OPEN_ITEM)
	const reporters =
		input.itemType === 'report'
			? Math.min(MAX_REPORTERS_BONUS, Math.max(0, input.distinctReporters - 1) * PER_EXTRA_REPORTER)
			: 0
	const offender = Math.min(MAX_SANCTIONS_BONUS, input.priorSanctions * PER_PRIOR_SANCTION)
	return Math.max(0, BASE_PRIORITY[input.itemType] + lobby + openItems + reporters + offender)
}
