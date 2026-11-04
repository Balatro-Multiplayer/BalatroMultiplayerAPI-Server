// Which tab an item type shows on. Automatic items (anti-cheat flags and
// integrity items) have their own tab; the main tab lists the rest, with the
// items players made first.
import type { ItemType } from './types.js'

export const AUTOMATIC_TYPES = [
	'anti_cheat',
	'integrity',
] as const satisfies readonly ItemType[]

// Items a player raised themselves. Appeals join this list when they exist.
export const PLAYER_MADE_TYPES = [
	'report',
	'contest',
] as const satisfies readonly ItemType[]

export type QueueLane = 'main' | 'automatic'

export function laneOf(itemType: ItemType): QueueLane {
	return (AUTOMATIC_TYPES as readonly string[]).includes(itemType)
		? 'automatic'
		: 'main'
}
