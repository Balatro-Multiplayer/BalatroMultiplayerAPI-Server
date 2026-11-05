// A report the player took back before staff decided: the queue item is
// closed with this resolution action (the server's WITHDRAWN_ACTION).
export const WITHDRAWN_ACTION = 'withdrawn'

export const WITHDRAWN_TEXT = 'Withdrawn by the player'

export function isWithdrawn(item: { resolutionAction: string | null }): boolean {
  return item.resolutionAction === WITHDRAWN_ACTION
}

// How often an open item's view looks for a withdraw by the player; a closed
// item does not change.
export const OPEN_ITEM_REFRESH_MS = 10_000
