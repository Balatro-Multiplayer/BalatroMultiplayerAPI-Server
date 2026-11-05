import { and, asc, eq, isNull } from 'drizzle-orm'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { contests, lobbyRuns, matchmakingMatches } from '../db/schema.js'
import type { MatchFacts } from '../../features/contests/website-contest.service.js'

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

// True when this call stored the Contest; false when the player already had one on the match.
export async function insertWebsiteContest(runId: string, contesterId: string): Promise<boolean> {
	const rows = await db
		.insert(contests)
		.values({ runId, kind: 'website', contesterId, againstId: null })
		.onConflictDoNothing({ target: [contests.runId, contests.contesterId] })
		.returning({ id: contests.id })
	return rows.length > 0
}

// The Contests of a match that are still standing, oldest first. Run inside the
// withdraw transaction so it sees the Contest just withdrawn.
export async function listLiveContestsOfRun(exec: DbExecutor, runId: string): Promise<ContestRecord[]> {
	return exec
		.select()
		.from(contests)
		.where(and(eq(contests.runId, runId), isNull(contests.withdrawnAt)))
		.orderBy(asc(contests.createdAt), asc(contests.id))
}

// What decides whether a match can be contested from the website; null when no such run is stored.
export async function getMatchFactsOf(runId: string): Promise<MatchFacts | null> {
	const [run] = await db
		.select({ lobbyCode: lobbyRuns.lobbyCode, finalizedAt: lobbyRuns.finalizedAt })
		.from(lobbyRuns)
		.where(eq(lobbyRuns.id, runId))
		.limit(1)
	if (!run) return null
	const [match] = await db
		.select({ players: matchmakingMatches.players, gameMode: matchmakingMatches.gameMode, status: matchmakingMatches.status })
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.matchId, runId))
		.limit(1)
	return {
		lobbyCode: run.lobbyCode,
		endedAt: run.finalizedAt,
		matchmade: !!match,
		ranked: !!match && match.gameMode.startsWith('ranked:'),
		players: Array.isArray(match?.players) ? (match.players as string[]) : [],
		voided: match?.status === 'voided',
	}
}
