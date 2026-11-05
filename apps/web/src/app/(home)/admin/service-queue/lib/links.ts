// Links out of a queue item. They carry `?item=<id>` so the page they open can
// show "Back to queue item", and keep the claim while staff are away.

const withItem = (href: string, itemId: number | null) =>
  itemId === null ? href : `${href}?item=${itemId}`

export const playerHref = (playerId: string, itemId: number | null = null) =>
  withItem(`/admin/players/${playerId}`, itemId)

export const matchHref = (runId: string, itemId: number | null = null) =>
  withItem(`/matches/${runId}`, itemId)

// The queue's own address for an open item (the queue reads `item`).
export const queueItemHref = (itemId: number) =>
  `/admin/service-queue?item=${itemId}`

// The `item` query value as an item id, or null when it is missing or wrong.
export function itemIdOf(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const id = Number.parseInt(value, 10)
  return id > 0 ? id : null
}
