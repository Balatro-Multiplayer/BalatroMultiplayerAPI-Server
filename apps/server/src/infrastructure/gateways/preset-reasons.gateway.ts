import { parsePresetReasons } from '../../features/service-queue/preset-reasons.js'
import { ITEM_TYPES, type ItemType } from '../../shared/service-queue/items.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { presetReasons } from '../db/schema.js'

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

