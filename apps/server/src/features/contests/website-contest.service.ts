// A Contest made from the match page on the website, after the match. It does
// not change the result or the ratings: it joins the match's one queue item
// (or opens it) and staff decide the match once. The rules here are pure; the
// service reads the match and writes the Contest through injected dependencies.

export const WEBSITE_CONTEST_WINDOW_MS = 24 * 60 * 60 * 1000

// What the rules need to know about a stored match.
export interface MatchFacts {
	lobbyCode: string
	// When the match ended; null while it is still running.
	endedAt: Date | null
	matchmade: boolean
	ranked: boolean
	players: string[]
	voided: boolean
}

export type WebsiteContestRefusal =
	// No such match, or the player was not in it.
	| 'not_found'
	| 'not_matchmade'
	| 'too_few_players'
	| 'still_running'
	| 'voided'
	| 'window_closed'
	| 'already_contested'
	// Staff already decided the match's queue item.
	| 'decided'

export function checkWebsiteContest(
	match: MatchFacts | null,
	playerId: string,
	alreadyContested: boolean,
	now: Date,
): WebsiteContestRefusal | null {
	if (!match || !match.players.includes(playerId)) return 'not_found'
	if (!match.matchmade) return 'not_matchmade'
	if (match.players.length < 2) return 'too_few_players'
	if (match.voided) return 'voided'
	if (!match.endedAt) return 'still_running'
	if (now.getTime() - match.endedAt.getTime() > WEBSITE_CONTEST_WINDOW_MS) return 'window_closed'
	if (alreadyContested) return 'already_contested'
	return null
}

export interface WebsiteContestDeps {
	matchFacts(runId: string): Promise<MatchFacts | null>
	hasContested(runId: string, playerId: string): Promise<boolean>
	// 'open' or 'withdrawn' (every Contest on it was withdrawn): a new Contest joins it.
	queueItemState(runId: string): Promise<'none' | 'open' | 'withdrawn' | 'decided'>
	// True when this call stored the Contest.
	addContest(runId: string, playerId: string): Promise<boolean>
	joinQueueItem(input: {
		runId: string
		contesterId: string
		summary: string
		lobbyKind: 'ranked' | 'casual'
		now: Date
	}): Promise<void>
	now(): Date
}

export type WebsiteContestResult = { ok: true } | { ok: false; refusal: WebsiteContestRefusal }

export function createWebsiteContestService(deps: WebsiteContestDeps) {
	async function refusalFor(runId: string, playerId: string): Promise<{ refusal: WebsiteContestRefusal | null; match: MatchFacts | null }> {
		const match = await deps.matchFacts(runId)
		const contested = match?.players.includes(playerId) ? await deps.hasContested(runId, playerId) : false
		const refusal = checkWebsiteContest(match, playerId, contested, deps.now())
		if (refusal) return { refusal, match }
		if ((await deps.queueItemState(runId)) === 'decided') return { refusal: 'decided', match }
		return { refusal: null, match }
	}

	return {
		// Whether the match page shows the Contest button to this player.
		async eligibility(runId: string, playerId: string): Promise<WebsiteContestResult> {
			const { refusal } = await refusalFor(runId, playerId)
			return refusal ? { ok: false, refusal } : { ok: true }
		},

		async contest(runId: string, playerId: string): Promise<WebsiteContestResult> {
			const { refusal, match } = await refusalFor(runId, playerId)
			if (refusal || !match) return { ok: false, refusal: refusal ?? 'not_found' }
			// The unique key on (match, player) settles a double click.
			if (!(await deps.addContest(runId, playerId))) return { ok: false, refusal: 'already_contested' }
			const lobbyKind = match.ranked ? 'ranked' : 'casual'
			await deps.joinQueueItem({
				runId,
				contesterId: playerId,
				summary: `Contested ${lobbyKind} match from the website, lobby ${match.lobbyCode}`,
				lobbyKind,
				now: deps.now(),
			})
			return { ok: true }
		},
	}
}

export type WebsiteContestService = ReturnType<typeof createWebsiteContestService>
