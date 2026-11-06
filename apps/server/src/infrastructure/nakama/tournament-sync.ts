import { type Result, err, ok } from '../../shared/utils/result.js'
import { callNakamaRpc, isNakamaAdminEnabled } from './admin-client.js'

// The webadmin Tournaments page reaching Nakama's tournament admin RPCs
// (nakama/src/tournament/admin.ts, and admin_tournament_close in
// nakama/src/tournament/rpc.ts).

export type TournamentStatus =
	| 'draft'
	| 'registration'
	| 'check_in'
	| 'running'
	| 'finished'
	| 'cancelled'

export interface NakamaTournamentSummary {
	id: string
	name: string
	format: string
	status: TournamentStatus
	visibility: 'public' | 'private'
	organiserId: string
	organiserName: string
	players: number
	maxPlayers: number
	waitlist: number
	startsAt: number
	official: boolean
	requireRanked: boolean
	finishedAt: number | null
}

export interface NakamaTournamentDetail {
	id: string
	name: string
	description: string
	notice: string
	status: TournamentStatus
	visibility: 'public' | 'private'
	official: boolean
	requireRanked: boolean
	inviteCode: string
	format: string
	maxPlayers: number
	gameMode: string
	ruleset: string
	organiser: { id: string; name: string }
	coOrganisers: { id: string; name: string }[]
	entrants: { id: string; name: string; checkedIn: boolean; dropped: boolean }[]
	waitlist: { id: string; name: string }[]
	createdAt: number
	startsAt: number
	startedAt: number | null
	finishedAt: number | null
	closed: { reason: string; message: string | null; at: number } | null
}

// active: not over yet (drafts included); over: finished or cancelled.
export type TournamentListStatus = 'active' | 'over' | 'all'

// unavailable: Nakama is off or not reached.
export async function listNakamaTournaments(
	status: TournamentListStatus,
	search: string,
): Promise<Result<NakamaTournamentSummary[], 'unavailable'>> {
	const result = await callNakamaRpc<{
		tournaments: NakamaTournamentSummary[]
	}>('admin_tournament_list', {
		status,
		...(search ? { search } : {}),
	})
	return result.ok ? ok(result.value.tournaments) : err('unavailable')
}

export async function getNakamaTournament(
	id: string,
): Promise<Result<NakamaTournamentDetail, 'not_found' | 'unavailable'>> {
	const result = await callNakamaRpc<{ tournament: NakamaTournamentDetail }>(
		'admin_tournament_get',
		{ id },
	)
	if (result.ok) return ok(result.value.tournament)
	return err(result.error === 'not_found' ? 'not_found' : 'unavailable')
}

// not_found: no such tournament. refused: Nakama said no (most likely it has
// already ended). unavailable: Nakama is off or not reached.
export async function closeNakamaTournament(
	id: string,
	reason: string,
): Promise<Result<null, 'not_found' | 'refused' | 'unavailable'>> {
	if (!isNakamaAdminEnabled()) return err('unavailable')
	const result = await callNakamaRpc('admin_tournament_close', { id, reason })
	if (result.ok) return ok(null)
	if (result.error === 'not_found') return err('not_found')
	return err(result.error === 'rejected' ? 'refused' : 'unavailable')
}
