// Turns a matchmaker group into a seated lobby. Pure planning is split from
// the Nakama calls so the rules (a group must agree on what it queued for)
// can be tested.
import { generateCode, CODE_ATTEMPTS, MATCHMADE_CODE_LENGTH } from '../lobby/rpc'
import { bindCode, releaseCode, reserveCode } from '../lobby/codes'
import { LOBBY_MATCH } from '../lobby/protocol'
import { refusedMemberOf, refusedPlayers, requeueSolos, type RefusedPlayer } from './gate'
import { GROUP_SIZE_PROPERTY, TEAMS_PROPERTY } from './group/refusal'
import {
	announceMatched,
	cancelGroupFor,
	requeueGroup,
	requeuePartiesOf,
	resolveGroups,
	type ResolvedGroups,
} from './group/matched'
import { partitionTeams, type TeamPlan } from './group/teams'
import { clearMatched } from './queue'
import { readConfig } from '../config'
import { requiredStandingFor, type RequiredStanding } from '../standing/standing'
import { pinFor } from '../lobby/pvp/ranked_pin'
import { settingsOf } from '../server_kind'

// A matched ticket's player. Numeric ticket properties arrive merged into
// properties; partyId is set for a party ticket's members.
export interface MatchedEntry {
	presence: { userId: string }
	properties: { [key: string]: string | number }
	partyId?: string
}

// A party's members, matched together off its one ticket.
export interface PlannedGroup {
	partyId: string
	memberIds: string[]
}

export interface MatchPlan {
	modId: string
	// The rating board the game counts on, '' for a casual game.
	rankedMode: string
	// The queue, keyed as the API keys it: 'mode', or 'ranked:mode'.
	gameMode: string
	playerIds: string[]
	groups: PlannedGroup[]
	// A Teams game: who plays on which team, each group on one.
	teamPlan: TeamPlan | null
	// What a returning player must have again (lobby/match.ts), worked out
	// from the config when the match is made (matchmakerMatched).
	requiredStanding: RequiredStanding
}

// How the API names a queue: the bare mode, 'ranked:'-prefixed when ranked.
export function queueKey(mode: string, kind: string): string {
	return kind === 'ranked' ? 'ranked:' + mode : mode
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

// The parties of a match in the order their first member was matched, a
// solo player as a group of one; or why the tickets' group sizes don't add up.
function groupsOf(entries: MatchedEntry[]): { party: PlannedGroup[]; all: string[][] } | string {
	const party: PlannedGroup[] = []
	const all: string[][] = []
	for (const entry of entries) {
		const size = entry.properties[GROUP_SIZE_PROPERTY]
		if (!entry.partyId) {
			if (size !== undefined && size !== 1) return 'A solo ticket claims a group'
			all.push([entry.presence.userId])
			continue
		}
		let group = party.filter((g) => g.partyId === entry.partyId)[0]
		if (!group) {
			group = { partyId: entry.partyId, memberIds: [] }
			party.push(group)
			all.push(group.memberIds)
		}
		group.memberIds.push(entry.presence.userId)
	}
	for (const group of party) {
		for (const entry of entries) {
			if (entry.partyId === group.partyId && entry.properties[GROUP_SIZE_PROPERTY] !== group.memberIds.length)
				return 'A group ticket disagrees with its group size'
		}
	}
	return { party, all }
}

// What a matched group queued for, or why it can't be a lobby. Everyone must
// have asked for the same mod, mode and kind: the query already ensures it,
// this stops a hand-built ticket from dragging others into a different game.
// Groups are casual only, and a Teams game (every ticket teams = 1) must
// split into two equal teams with each group kept whole.
export function planMatch(entries: MatchedEntry[], integrityEnforced = false): MatchPlan | string {
	if (entries.length < 2) return 'A match needs at least two players'
	const first = entries[0].properties
	const modId = first.modId
	const mode = first.mode
	const kind = first.kind === 'ranked' ? 'ranked' : 'casual'
	const teams = first[TEAMS_PROPERTY] === 1
	if (typeof modId !== 'string' || typeof mode !== 'string' || !NAME_PATTERN.test(modId) || !NAME_PATTERN.test(mode))
		return 'Ticket has no valid modId and mode'
	const ids: string[] = []
	for (const entry of entries) {
		const p = entry.properties
		if (
			p.modId !== modId ||
			p.mode !== mode ||
			(p.kind === 'ranked' ? 'ranked' : 'casual') !== kind
		)
			return 'Tickets disagree on what they queued for'
		if ((p[TEAMS_PROPERTY] === 1) !== teams) return 'Tickets disagree on Teams'
		if (ids.indexOf(entry.presence.userId) !== -1)
			return 'A player is in the match twice'
		ids.push(entry.presence.userId)
	}
	const groups = groupsOf(entries)
	if (typeof groups === 'string') return groups
	if (groups.party.length > 0 && kind === 'ranked') return 'A group may not queue ranked'
	// A ranked PvP queue the server has no rules pin for is not a game it can referee.
	if (kind === 'ranked' && !pinFor(modId, mode).ok) return `unknown_ranked_mode: ${mode}`
	let teamPlan: TeamPlan | null = null
	if (teams) {
		const split = partitionTeams(groups.all)
		if (!split.ok) return 'Teams cannot be split: ' + split.error
		teamPlan = split.value
	}
	return {
		modId,
		rankedMode: kind === 'ranked' ? mode : '',
		gameMode: queueKey(mode, kind),
		playerIds: ids,
		groups: groups.party,
		teamPlan,
		requiredStanding: requiredStandingFor(kind === 'ranked', integrityEnforced),
	}
}

export function matchmakerMatched(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	matches: MatchedEntry[],
): string {
	const plan = planMatch(matches, readConfig(nk).integrityEnforced)
	if (typeof plan === 'string') {
		logger.warn('Matchmaker group refused: %s', plan)
		requeuePartiesOf(nk, partyIdsOf(matches))
		throw new Error(plan)
	}
	const refused = refusedPlayers(nk, settingsOf(ctx), plan, logger)
	const groups = resolveGroups(nk, plan)
	if (refused.length > 0 || groups.faulty.length > 0) {
		// The matchmaker spent every ticket of the group all the same, so their
		// queue records go too; left, Find Game counted these players as queued
		// until they reconnected. One still allowed to queue queues again,
		// which writes a fresh record.
		refuseMatch(nk, plan, refused, groups)
		clearMatched(nk, plan.modId, plan.gameMode, plan.playerIds)
		logger.warn(
			'Matched group refused: %d player(s) may not queue, %d group(s) not queueing',
			refused.length,
			groups.faulty.length,
		)
		throw new Error('A matched player may not queue')
	}
	for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
		const code = generateCode(MATCHMADE_CODE_LENGTH)
		if (!reserveCode(nk, code, plan.modId)) continue
		let matchId: string
		try {
			matchId = nk.matchCreate(LOBBY_MATCH, {
				code,
				modId: plan.modId,
				maxPlayers: plan.playerIds.length,
				creatorId: plan.playerIds[0],
				rankedMode: plan.rankedMode,
				allowedIds: plan.playerIds.join(','),
				gameMode: plan.gameMode,
				groups: groups.homes.length > 0 ? JSON.stringify(groups.homes) : '',
				teamPlan: plan.teamPlan ? JSON.stringify(plan.teamPlan) : '',
				requiredStanding: plan.requiredStanding,
			})
		} catch (e) {
			releaseCode(nk, code, '')
			throw e
		}
		bindCode(nk, code, matchId, plan.modId)
		clearMatched(nk, plan.modId, plan.gameMode, plan.playerIds)
		for (const home of groups.homes) announceMatched(nk, home, matchId, code)
		logger.info(
			'Matchmaker made lobby %s for %d players (%s%s)',
			code,
			plan.playerIds.length,
			plan.modId,
			plan.rankedMode ? ', ranked ' + plan.rankedMode : '',
		)
		return matchId
	}
	throw new Error('Could not allocate a lobby code')
}

function partyIdsOf(matches: MatchedEntry[]): string[] {
	const ids: string[] = []
	for (const m of matches) if (m.partyId && ids.indexOf(m.partyId) === -1) ids.push(m.partyId)
	return ids
}

// Who is told what about a refused match: solo players allowed to queue queue
// again; a group queues again unless one of its members was refused or it no
// longer fits, in which case its home lets it go.
function refuseMatch(nk: nkruntime.Nakama, plan: MatchPlan, refused: RefusedPlayer[], groups: ResolvedGroups) {
	requeueSolos(nk, plan, refused)
	for (const home of groups.homes) {
		const member = refused.filter((r) => home.memberIds.indexOf(r.userId) !== -1)[0]
		if (!member) requeueGroup(nk, home)
		else cancelGroupFor(nk, home.homeCode, home.partyId, 'member_refused', refusedMemberOf(member))
	}
	for (const fault of groups.faulty) {
		if (fault.binding) cancelGroupFor(nk, fault.binding.homeCode, fault.partyId, 'match_refused')
	}
}
