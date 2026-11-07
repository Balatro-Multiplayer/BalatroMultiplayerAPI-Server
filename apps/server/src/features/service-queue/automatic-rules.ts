// Which automatic items exist. The live rules: an integrity item only for a
// launcher failure during ranked play (integrity-flag.ts), no anti-cheat item
// for a match in which every player is flagged, and no unverified-log flag for
// a game that was not played out or a player who sent no result (Nakama's
// lobby/anticheat.ts). This file holds the all-flagged rule and the one-time
// job's version of all three: it closes the open items the rules would not
// make. Pure; the data access is passed in.
import type { FlagReason } from '../nakama/mirror.service.js'
import type { ItemContext } from './types.js'

// A match with one player has no other player to compare with, so its flag stays.
export function raisesAntiCheatItem(match: { playerCount: number; flaggedCount: number }): boolean {
	return match.playerCount < 2 || match.flaggedCount < match.playerCount
}

export type ObsoleteRule =
	| 'integrity_outside_ranked'
	| 'anticheat_every_player_flagged'
	| 'unverified_log_game_not_played_out'
	| 'unverified_log_no_result'

const REASONS: Record<ObsoleteRule, string> = {
	integrity_outside_ranked: 'a launcher failure outside ranked play makes no item',
	anticheat_every_player_flagged: 'every player of the match is flagged',
	unverified_log_game_not_played_out: 'an unverified log of a restarted or abandoned game is not flagged',
	unverified_log_no_result: 'an unverified log of a player who sent no result is not flagged',
}

export function noteOf(rule: ObsoleteRule): string {
	return `Closed by the system: ${REASONS[rule]} (rule ${rule})`
}

// What the job knows about one open item.
export type ObsoleteFacts =
	| { itemType: 'integrity'; context: ItemContext }
	| {
			itemType: 'anti_cheat'
			flagReason: FlagReason | null
			// lobby_runs.status
			runStatus: 'active' | 'completed' | 'abandoned' | 'terminated'
			runPlayers: number
			// Players of the run with a flag on their log.
			runFlagged: number
			// Whether the player's log holds its closing 'end' event, which only a
			// player who reported a result writes.
			logHasEnd: boolean
	  }

export function obsoleteRuleOf(facts: ObsoleteFacts): { rule: ObsoleteRule; note: string } | null {
	const hit = (rule: ObsoleteRule) => ({ rule, note: noteOf(rule) })
	if (facts.itemType === 'integrity')
		return facts.context.integrityTrigger === 'ranked' ? null : hit('integrity_outside_ranked')
	if (!raisesAntiCheatItem({ playerCount: facts.runPlayers, flaggedCount: facts.runFlagged }))
		return hit('anticheat_every_player_flagged')
	if (facts.flagReason !== 'unverified_log') return null
	if (facts.runStatus === 'terminated' || facts.runStatus === 'abandoned') return hit('unverified_log_game_not_played_out')
	if (!facts.logHasEnd) return hit('unverified_log_no_result')
	return null
}

export interface ObsoleteCandidate {
	id: number
	playerId: string | null
	facts: ObsoleteFacts
}

export interface CloseObsoleteDeps {
	// Every open automatic item. Closed items are not listed, so a second run
	// finds only what the first left.
	listOpen(): Promise<ObsoleteCandidate[]>
	// Dismisses the item as the system and writes its staff log entry, in one
	// transaction. False when the item was no longer open.
	close(input: { id: number; playerId: string | null; rule: ObsoleteRule; note: string }): Promise<boolean>
}

export interface CloseObsoleteResult {
	closed: number
	kept: number
	skipped: number
	byRule: Partial<Record<ObsoleteRule, number>>
}

export async function closeObsoleteItems(deps: CloseObsoleteDeps): Promise<CloseObsoleteResult> {
	const result: CloseObsoleteResult = { closed: 0, kept: 0, skipped: 0, byRule: {} }
	for (const candidate of await deps.listOpen()) {
		const verdict = obsoleteRuleOf(candidate.facts)
		if (!verdict) {
			result.kept++
			continue
		}
		const done = await deps.close({ id: candidate.id, playerId: candidate.playerId, ...verdict })
		if (!done) {
			result.skipped++
			continue
		}
		result.closed++
		result.byRule[verdict.rule] = (result.byRule[verdict.rule] ?? 0) + 1
	}
	return result
}
