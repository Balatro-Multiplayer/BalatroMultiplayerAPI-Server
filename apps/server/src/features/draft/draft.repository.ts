// Draft persistence seam: per-match issued POOLS (the draft tuples offered to
// a match). The service depends on the `DraftRepository` interface, not a
// concrete store, so the feature is testable via the in-memory fake (real
// fakes over interaction mocks).
//
// Every method is `async` even though this impl is fully synchronous -- the
// interface is the seam for a future Drizzle-backed store (a draft_pools
// table, deferred until the pending moderation schema/migration lands) that
// awaits for real. The service must never change when that swap happens.

import type { DraftTuple } from './generate-draft-pool.js'

// --- the contract (what the service depends on) ---

export interface DraftRepository {
	getPool(matchId: string): Promise<DraftTuple[] | undefined>
	savePool(matchId: string, pool: DraftTuple[]): Promise<void>
}

// --- in-memory implementation ---

const DAY_MS = 24 * 60 * 60 * 1000 // default eviction TTL

export interface InMemoryDraftRepositoryOptions {
	/** Entries untouched (written) for longer than this are evicted. */
	ttlMs?: number
	/** Injectable ms-epoch clock so eviction is testable with a fake clock. */
	now?: () => number
}

interface PoolEntry {
	pool: DraftTuple[]
	touchedAt: number
}

export class InMemoryDraftRepository implements DraftRepository {
	private pools = new Map<string, PoolEntry>()

	// --- TTL eviction ---
	private readonly ttlMs: number
	private readonly now: () => number

	private isExpired(touchedAt: number): boolean {
		return this.now() - touchedAt > this.ttlMs
	}

	// A draft lives minutes; the TTL only bounds memory over the process
	// lifetime. Sweeping on writes (no timer) suffices: a quiet server holds at
	// most the last day's matches, an active one sweeps constantly.
	private sweep(): void {
		for (const [matchId, entry] of this.pools)
			if (this.isExpired(entry.touchedAt)) this.pools.delete(matchId)
	}
	// --- end TTL eviction ---

	constructor(opts: InMemoryDraftRepositoryOptions = {}) {
		this.ttlMs = opts.ttlMs ?? DAY_MS
		this.now = opts.now ?? Date.now
	}

	async getPool(matchId: string): Promise<DraftTuple[] | undefined> {
		const entry = this.pools.get(matchId)
		if (!entry || this.isExpired(entry.touchedAt)) return undefined
		return entry.pool
	}

	async savePool(matchId: string, pool: DraftTuple[]): Promise<void> {
		this.sweep()
		this.pools.set(matchId, { pool, touchedAt: this.now() })
	}
}
