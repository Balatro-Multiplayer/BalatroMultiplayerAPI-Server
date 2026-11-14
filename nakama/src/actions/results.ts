// Ending a started game: every participant reports the placements
// (mpapi_report_result), and once they're all in -- or the clock runs out --
// the reports are reconciled into one result, handed off to be stored, and
// the lobby is free to start again. Pure, like the rest of src/actions.
import { refereeOf } from '../lobby/pvp/state'
import {
	type GameEnd,
	type GameEnded,
	type Participant,
	type Placement,
	type RunRecord,
	type RunStatus,
	ServerOp,
} from '../lobby/protocol'
import { type Lobby, type Outbound, type Step, emptyGame } from '../lobby/state'
import { normalizeScore } from '../../../packages/types/src/big-score'

// A report's placements, or why it's malformed. Every participant must be
// placed exactly once.
export function parsePlacements(
	value: unknown,
	participants: Participant[],
): Placement[] | null {
	if (!Array.isArray(value) || value.length !== participants.length)
		return null
	const expected: { [id: string]: boolean } = {}
	for (const p of participants) expected[p.id] = true
	const seen: { [id: string]: boolean } = {}
	const placements: Placement[] = []
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null) return null
		const { playerId, place, performance, metric, metricText } = entry as {
			[key: string]: unknown
		}
		if (typeof playerId !== 'string' || !expected[playerId] || seen[playerId])
			return null
		if (typeof place !== 'number' || place % 1 !== 0 || place < 1)
			return null
		const placement: Placement = { playerId, place }
		if (performance !== undefined && performance !== null) {
			if (typeof performance !== 'number' || !(performance >= 0 && performance <= 1))
				return null
			placement.performance = performance
		}
		if (metric !== undefined && metric !== null) {
			if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0)
				return null
			// Whole units: the season-best mirror stores it as a bigint.
			placement.metric = Math.round(metric)
		}
		// Bad score text (or one over the array limit) drops only the season best.
		if (typeof metricText === 'string') {
			const text = normalizeScore(metricText)
			if (text !== null) placement.metricText = text
		}
		seen[playerId] = true
		placements.push(placement)
	}
	return sortedById(placements)
}

function sortedById(placements: Placement[]): Placement[] {
	return placements
		.slice()
		.sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
}

// Two reports agree when they give everyone the same place; performance and
// metric come along from whichever report is recorded: the host's when it is
// in the group, else the first. The host's copy is the one to keep: in a
// host-refereed game (PvP) only the host holds every player's scores, so a
// guest's agreeing report carries metric 0 for everyone, and recording it just
// because it arrived first wiped the season-best column.
function placesKey(placements: Placement[]): string {
	return JSON.stringify(sortedById(placements).map((p) => [p.playerId, p.place]))
}

// The recorded placements and status for the reports in so far.
export function reconcile(
	reports: { [userId: string]: Placement[] },
	reportOrder: string[],
	participants: Participant[],
	hostId: string,
): { status: RunStatus; placements: Placement[] } {
	const reporters = reportOrder.filter((id) => reports[id] !== undefined)
	if (reporters.length === 0) return { status: 'abandoned', placements: [] }

	const groups: { [key: string]: string[] } = {}
	const keys: string[] = []
	for (const id of reporters) {
		const key = placesKey(reports[id])
		if (!groups[key]) {
			groups[key] = []
			keys.push(key)
		}
		groups[key].push(id)
	}

	if (keys.length === 1) {
		const everyone = participants.every((p) => reports[p.id] !== undefined)
		return {
			status: everyone ? 'agreed' : 'partial',
			placements: reports[preferHost(groups[keys[0]], hostId)],
		}
	}

	// Biggest group wins; a tie goes to the host's report, then to whichever
	// report came first (keys are in first-report order).
	let best = keys[0]
	for (const key of keys) {
		const size = groups[key].length
		const bestSize = groups[best].length
		const hasHost = groups[key].indexOf(hostId) !== -1
		const bestHasHost = groups[best].indexOf(hostId) !== -1
		if (size > bestSize || (size === bestSize && hasHost && !bestHasHost))
			best = key
	}
	return { status: 'disputed', placements: reports[preferHost(groups[best], hostId)] }
}

function preferHost(group: string[], hostId: string): string {
	return group.indexOf(hostId) !== -1 ? hostId : group[0]
}

// Participants of the started game still seated in the lobby (an away player
// counts until their grace period runs out).
function remainingParticipants(lobby: Lobby): string[] {
	const started = lobby.game.started
	if (!started) return []
	const seated: { [id: string]: boolean } = {}
	for (const p of lobby.players) seated[p.id] = true
	return started.players.filter((p) => seated[p.id]).map((p) => p.id)
}

// A started PvP game: the server referees it from its first batch
// (docs/pvp-match.md section 4), before pvpTick freezes the rules. Its result comes from the
// referee, never from client reports.
export function isRefereed(lobby: Lobby): boolean {
	return refereeOf(lobby) !== null
}

// How a caller ends the game other than by reconciling the reports.
export type FinishOverride = {
	status: RunStatus
	announce: boolean
	placements?: Placement[]
}

// Ends the started game: the record to store, GAME_ENDED to everyone (unless
// `announce` is false, as for a restart), and a clean game state.
export function finishGame(
	lobby: Lobby,
	now: number,
	override?: FinishOverride,
): Step {
	const game = lobby.game
	const started = game.started
	if (!started) return { lobby, out: [] }

	const reconciled = reconcile(
		game.reports,
		game.reportOrder,
		started.players,
		started.hostId,
	)
	// A contest outranks every other ending: the run waits on a moderator.
	const status: RunStatus = game.contest
		? 'contested'
		: override
			? override.status
			: reconciled.status
	// Given placements (a PvP referee result) are recorded as they are: the
	// reports are not reconciled into them.
	const placements =
		status === 'abandoned' || status === 'dodged'
			? []
			: override?.placements
				? sortedById(override.placements)
				: reconciled.placements
	const run: RunRecord = {
		runId: started.runId,
		code: lobby.code,
		modId: lobby.modId,
		seed: started.seed,
		stake: started.stake,
		options: started.options,
		startedAt: started.startedAt,
		endedAt: now,
		status,
		placements,
		reports: game.reports,
		reportOrder: game.reportOrder,
		players: started.players,
		rankedMode: lobby.rankedMode,
		gameMode: lobby.gameMode,
		lobbyType: lobby.rankedMode || lobby.allowedIds ? 'public' : 'private',
		...(game.contest ? { contest: game.contest } : {}),
		...(game.presence && game.presence.length > 0 ? { presence: game.presence } : {}),
	}

	const seated: { [id: string]: boolean } = {}
	for (const p of lobby.players) seated[p.id] = true
	const lateResultTo =
		game.resultWasPending && status !== 'abandoned' && status !== 'dodged'
			? started.players.filter((p) => !seated[p.id]).map((p) => p.id)
			: []

	const announced = !override || override.announce
	// Started players who were not attached to hear GAME_ENDED keep the end for their
	// next snapshot (game.endedAway).
	const attached = new Set(lobby.players.filter((p) => p.awaySince === null).map((p) => p.id))
	const missed: { [id: string]: GameEnd } = {}
	if (announced)
		for (const p of started.players)
			if (!attached.has(p.id)) missed[p.id] = { runId: started.runId, status }
	const next = {
		...lobby,
		lastRunId: started.runId,
		game: Object.keys(missed).length > 0 ? { ...emptyGame(), endedAway: missed } : emptyGame(),
	}
	const out: Outbound[] = [{ kind: 'saveRun', run, logs: game.logs, lateResultTo }]
	if (announced) {
		const ended: GameEnded = { runId: started.runId, status, placements }
		out.push({
			kind: 'send',
			op: ServerOp.EVENT,
			payload: { type: 'game_ended', lobbyCode: lobby.code, data: ended },
			to: next.players.map((p) => p.id),
		})
	}
	return { lobby: next, out }
}

// Time passing (and after each report): ends the game once every remaining
// participant has reported, or once the result clock -- started by the first
// report, or by the game dropping under two players -- runs out.
export function settle(lobby: Lobby, now: number): Step {
	const started = lobby.game.started
	if (!started) return { lobby, out: [] }

	const remaining = remainingParticipants(lobby)
	if (remaining.length === 0) return finishGame(lobby, now)

	// A refereed PvP game ends only in pvpTick (a result, or a forfeit), so
	// reports and the pending hold play no part: what is left is the hard cap
	// (everyone gone, or down to one player for the result timeout), which
	// stores the run abandoned and unrated.
	if (!isRefereed(lobby)) {
		// A pending result holds the run open: no clock, and reports alone do not
		// end it. Clearing the flag settles it as usual. A contest outranks the
		// hold, or a contested run would never reach a moderator.
		if (lobby.game.resultPending && !lobby.game.contest)
			return { lobby, out: [] }

		const reports = lobby.game.reports
		const anyReport = lobby.game.reportOrder.length > 0
		if (anyReport && remaining.every((id) => reports[id] !== undefined))
			return finishGame(lobby, now)
	}

	let current = lobby
	if (current.game.settleFrom === null && remaining.length < 2) {
		current = { ...current, game: { ...current.game, settleFrom: now } }
	}
	const from = current.game.settleFrom
	if (from !== null && now - from >= current.resultTimeoutMs)
		return finishGame(current, now)
	return { lobby: current, out: [] }
}
