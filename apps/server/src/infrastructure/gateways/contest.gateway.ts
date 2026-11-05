import { and, asc, eq, isNull } from 'drizzle-orm'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { contests } from '../db/schema.js'

export type ContestRecord = typeof contests.$inferSelect

export type ContestKind = 'in_game' | 'website'

export interface NewContest {
	runId: string
	kind: ContestKind
	contesterId: string
	againstId: string | null
	createdAt: Date
}

// Once per player and match: a retried mirror entry finds it there.
export async function insertContest(contest: NewContest, exec: DbExecutor = db): Promise<void> {
	await exec.insert(contests).values(contest).onConflictDoNothing({ target: [contests.runId, contests.contesterId] })
}

export async function getContestOf(runId: string, contesterId: string): Promise<ContestRecord | null> {
	const [row] = await db
		.select()
		.from(contests)
		.where(and(eq(contests.runId, runId), eq(contests.contesterId, contesterId)))
		.limit(1)
	return row ?? null
}

// Every Contest of a match, oldest first: what the match's queue item holds.
export async function listContestsOfRun(runId: string): Promise<ContestRecord[]> {
	return db.select().from(contests).where(eq(contests.runId, runId)).orderBy(asc(contests.createdAt), asc(contests.id))
}

// True for the one call that opened the Contest's one-time page.
export async function markContestPageOpened(id: number, now: Date): Promise<boolean> {
	const rows = await db
		.update(contests)
		.set({ pageOpenedAt: now })
		.where(and(eq(contests.id, id), isNull(contests.pageOpenedAt)))
		.returning({ id: contests.id })
	return rows.length > 0
}

export async function setContestDetail(id: number, reason: string | null, detail: string): Promise<void> {
	await db.update(contests).set({ reason, detail }).where(eq(contests.id, id))
}

// Inside the withdraw transaction; false when it was already withdrawn.
export async function markContestWithdrawn(exec: DbExecutor, id: number, now: Date): Promise<boolean> {
	const rows = await exec
		.update(contests)
		.set({ withdrawnAt: now })
		.where(and(eq(contests.id, id), isNull(contests.withdrawnAt)))
		.returning({ id: contests.id })
	return rows.length > 0
}
