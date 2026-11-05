// Preset reasons: ready-made notes staff pick for a queue item of one type.
// One ordered list per item type, edited by admins. Pure checks only; the
// gateway stores the lists and the route logs each edit.

import { ITEM_TYPES, type ItemType } from '../../shared/service-queue/items.js'

export const MAX_PRESET_REASONS = 20
export const MAX_PRESET_LENGTH = 200

export const isItemType = (value: unknown): value is ItemType =>
	typeof value === 'string' && (ITEM_TYPES as readonly string[]).includes(value)

export type ParsedPresetReasons =
	| { ok: true; reasons: string[] }
	| { ok: false; message: string }

// A list of trimmed, non-empty notes in the order given. A note that repeats
// an earlier one is refused, as a chip twice is a mistake.
export function parsePresetReasons(value: unknown): ParsedPresetReasons {
	if (!Array.isArray(value))
		return { ok: false, message: 'reasons must be a list' }
	if (value.length > MAX_PRESET_REASONS)
		return {
			ok: false,
			message: `at most ${MAX_PRESET_REASONS} preset reasons`,
		}
	const reasons: string[] = []
	for (const entry of value) {
		if (typeof entry !== 'string' || !entry.trim())
			return { ok: false, message: 'a preset reason cannot be empty' }
		const text = entry.trim()
		if (text.length > MAX_PRESET_LENGTH)
			return {
				ok: false,
				message: `a preset reason is over ${MAX_PRESET_LENGTH} characters`,
			}
		if (reasons.includes(text))
			return { ok: false, message: 'a preset reason is listed twice' }
		reasons.push(text)
	}
	return { ok: true, reasons }
}
