// Bulk dismiss of one player's open automatic items: one reason, one dismiss
// per item through the normal dispatcher, so each item keeps its own event.
import type { Staff } from './dispatcher.js'

export interface AutomaticDismissDeps {
	openItemIds(playerId: string): Promise<number[]>
	run(
		itemId: number,
		action: 'dismiss',
		staff: Staff,
		body: { note: string },
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
		const result = await deps.run(itemId, 'dismiss', staff, { note })
		if (result.ok) dismissed++
		else failed.push({ itemId, code: result.code })
	}
	return { ok: true, dismissed, failed }
}
