import { useEffect } from 'react'
import { claimItem } from './api'

// A claim lasts 15 minutes server-side; renew well before it runs out.
export const CLAIM_RENEW_MS = 10 * 60_000

// Keeps the claim of the queue item staff came from while they are on a
// player or match page opened from it. It renews at once (the claim may be
// part way through its time) and then on a timer. A claim someone else took
// stays theirs, and an item that closed has nothing to renew.
export function useClaimRenewal(itemId: number | null): void {
  useEffect(() => {
    if (itemId === null) return
    const renew = () => void claimItem(itemId).catch(() => {})
    renew()
    const timer = setInterval(renew, CLAIM_RENEW_MS)
    return () => clearInterval(timer)
  }, [itemId])
}
