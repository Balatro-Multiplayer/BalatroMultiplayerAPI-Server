import { parsePresetReasons } from '../../features/service-queue/preset-reasons.js'
import { ITEM_TYPES, type ItemType } from '../../shared/service-queue/items.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { presetReasons } from '../db/schema.js'
import { recordStaffAction } from './staff-log.gateway.js'

// The list of every item type, in order. A type with no stored row has none.
export async function getPresetReasons(
	exec: DbExecutor = db,
): Promise<Record<ItemType, string[]>> {
	const rows = await exec.select().from(presetReasons)
	const lists = Object.fromEntries(
		ITEM_TYPES.map((type) => [type, [] as string[]]),
	) as Record<ItemType, string[]>
	for (const row of rows) {
		const parsed = parsePresetReasons(row.reasons)
		if (parsed.ok && row.itemType in lists)
			lists[row.itemType as ItemType] = parsed.reasons
	}
	return lists
}

export async function setPresetReasons(
	exec: DbExecutor,
	itemType: ItemType,
	reasons: readonly string[],
): Promise<void> {
	await exec
		.insert(presetReasons)
		.values({ itemType, reasons })
		.onConflictDoUpdate({
			target: presetReasons.itemType,
			set: { reasons, updatedAt: new Date() },
		})
}

// Replaces the list of one item type and logs the lists before and after, in
// one transaction. Returns every list as saved.
export async function editPresetReasons(
	staff: { playerId: string; role: 'admin' },
	itemType: ItemType,
	reasons: readonly string[],
	note: string,
): Promise<Record<ItemType, string[]>> {
	return db.transaction(async (tx) => {
		const before = (await getPresetReasons(tx))[itemType]
		await setPresetReasons(tx, itemType, reasons)
		await recordStaffAction(tx, {
			staff,
			action: 'preset_reasons_edit',
			reason: note,
			detail: { itemType, before, after: reasons },
		})
		return getPresetReasons(tx)
	})
}
