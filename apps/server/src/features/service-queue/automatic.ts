// Bulk dismiss of one player's open automatic items: one reason, one dismiss
// per item through the normal dispatcher, so each item keeps its own event.
import type { Staff } from './dispatcher.js'
import { AUTOMATIC_TYPES } from './lanes.js'

export interface AutomaticDismissDeps {
	openItemIds(playerId: string): Promise<number[]>
	run(
		itemId: number,
		action: 'dismiss',
		staff: Staff,
		body: { reason: string },
	): Promise<{ ok: true } | { ok: false; code: string }>
}

export type AutomaticDismissResult =
	| { ok: true; dismissed: number; failed: { itemId: number; code: string }[] }
	| { ok: false; error: 'reason_required' }

export async function dismissAutomaticItems(
	deps: AutomaticDismissDeps,
	playerId: string,
	staff: Staff,
	reason: string,
): Promise<AutomaticDismissResult> {
	const note = reason.trim()
	if (note === '') return { ok: false, error: 'reason_required' }
	let dismissed = 0
	const failed: { itemId: number; code: string }[] = []
	for (const itemId of await deps.openItemIds(playerId)) {
		const result = await deps.run(itemId, 'dismiss', staff, { reason: note })
		if (result.ok) dismissed++
		else failed.push({ itemId, code: result.code })
	}
	return { ok: true, dismissed, failed }
}

export interface ListedDismissDeps {
	// Null when the item is gone.
	itemTypeOf(itemId: number): Promise<string | null>
	run: AutomaticDismissDeps['run']
}

// Bulk dismiss of the items the rail shows: the web sends the ids it lists.
// Anything that is not an automatic item is refused, whatever the client sends;
// a claim held by someone else comes back from the dispatcher as a failure.
export async function dismissListedAutomaticItems(
	deps: ListedDismissDeps,
	itemIds: readonly number[],
	staff: Staff,
	reason: string,
): Promise<AutomaticDismissResult> {
	const note = reason.trim()
	if (note === '') return { ok: false, error: 'reason_required' }
	let dismissed = 0
	const failed: { itemId: number; code: string }[] = []
	for (const itemId of new Set(itemIds)) {
		const itemType = await deps.itemTypeOf(itemId)
		if (itemType === null) {
			failed.push({ itemId, code: 'not_found' })
			continue
		}
		if (!(AUTOMATIC_TYPES as readonly string[]).includes(itemType)) {
			failed.push({ itemId, code: 'not_automatic' })
			continue
		}
		const result = await deps.run(itemId, 'dismiss', staff, { reason: note })
		if (result.ok) dismissed++
		else failed.push({ itemId, code: result.code })
	}
	return { ok: true, dismissed, failed }
}
