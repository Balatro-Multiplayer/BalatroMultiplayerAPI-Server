// Leaving a queue item through a player or match link keeps its claim. The
// panel releases a claim when it unmounts, so a link click leaves a short
// note here, and the release reads it once. The note runs out fast: a click
// that opens a new tab never unmounts the panel and must not keep the claim
// of a later Skip.
export const KEEP_WINDOW_MS = 3_000

let kept: { itemId: number; at: number } | null = null

export function keepClaim(itemId: number, now = Date.now()): void {
  kept = { itemId, at: now }
}

// True once when the item's claim should stay; the note is used up.
export function takeKeepClaim(itemId: number, now = Date.now()): boolean {
  const note = kept
  kept = null
  return (
    note !== null && note.itemId === itemId && now - note.at <= KEEP_WINDOW_MS
  )
}

// Drops the note, for a Skip: it must release the claim even right after a link click.
export function forgetKeepClaim(): void {
  kept = null
}
