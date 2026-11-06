// Moderator RPCs for the web admin's Tournaments page, server to server only
// (the API calls them for admins and moderators). Closing one is
// admin_tournament_close in rpc.ts. Read-only: they never catch a
// tournament up, so a status can be a clock tick behind.
import { INVALID_ARGUMENT, NOT_FOUND, runtimeError } from '../errors'
import { parsePayload, requireServer } from '../rpc'
import type { Tournament } from './model'
import { TOURNAMENT_ID_PATTERN } from './rpc'
import { type IndexEntry, readTournament, scanIndex, tournamentIdForCode } from './storage'

// How many tournaments a list reads; the API pages through them.
export const ADMIN_LIST_LIMIT = 500

const ACTIVE = ['draft', 'registration', 'check_in', 'running']
const OVER = ['finished', 'cancelled']

// {status?: 'active' | 'over' | 'all', search?} -> {tournaments}: every
// tournament, private ones and drafts too. search matches the name, the
// organiser's name or the id (any part, any case), or an invite code exactly.
// Active ones come first by start, then ended ones, most recent first.
export function rpcAdminTournamentList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const status = input.status ?? 'active'
	if (status !== 'active' && status !== 'over' && status !== 'all') throw runtimeError(INVALID_ARGUMENT, 'status must be active, over or all')
	if (input.search !== undefined && typeof input.search !== 'string') throw runtimeError(INVALID_ARGUMENT, 'search must be a string')
	const search = ((input.search as string | undefined) ?? '').trim().toLowerCase()
	const byCode = search.length > 0 ? tournamentIdForCode(nk, search) : null
	const statuses = status === 'active' ? ACTIVE : status === 'over' ? OVER : ACTIVE.concat(OVER)
	const matches = (e: IndexEntry) =>
		!search || e.id === byCode || e.name.toLowerCase().indexOf(search) !== -1 || e.organiserName.toLowerCase().indexOf(search) !== -1 || e.id.indexOf(search) !== -1
	const entries = scanIndex(nk, (e) => statuses.indexOf(e.status) !== -1 && matches(e), ADMIN_LIST_LIMIT)
	entries.sort((a, b) => {
		const aOver = OVER.indexOf(a.status) !== -1
		const bOver = OVER.indexOf(b.status) !== -1
		if (aOver !== bOver) return aOver ? 1 : -1
		return aOver ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : a.startsAt - b.startsAt
	})
	return JSON.stringify({ tournaments: entries })
}

// Why a closed tournament ended: the moderator's reason, or how it ended.
function closedBy(t: Tournament): { reason: string; message: string | null; at: number } | null {
	if (t.status !== 'cancelled') return null
	for (let i = t.events.length - 1; i >= 0; i--) {
		const e = t.events[i]
		if (e.kind === 'cancelled') {
			return { reason: typeof e.reason === 'string' ? e.reason : 'unknown', message: typeof e.message === 'string' ? e.message : null, at: e.at }
		}
	}
	return null
}

// {id} -> {tournament}: what a moderator needs to judge it -- the texts
// players see (name, description, notice), who runs it and who plays.
export function rpcAdminTournamentGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const id = input.id
	if (typeof id !== 'string' || !TOURNAMENT_ID_PATTERN.test(id)) throw runtimeError(INVALID_ARGUMENT, 'id is not valid')
	const read = readTournament(nk, id)
	if (!read) throw runtimeError(NOT_FOUND, 'No such tournament')
	const t = read.t
	const names = t.coOrganiserNames ?? {}
	const dropped = t.dropped
	return JSON.stringify({
		tournament: {
			id: t.id,
			name: t.name,
			description: t.description,
			notice: t.notice ?? '',
			status: t.status,
			visibility: t.visibility,
			official: t.official === true,
			requireRanked: t.requireRanked === true,
			inviteCode: t.inviteCode,
			format: t.format,
			maxPlayers: t.maxPlayers,
			gameMode: t.rounds.defaults.gameMode,
			ruleset: t.rounds.defaults.ruleset,
			organiser: { id: t.organiserId, name: t.organiserName },
			coOrganisers: t.coOrganiserIds.map((userId) => ({ id: userId, name: names[userId] ?? '' })),
			entrants: t.entrants.map((e) => ({ id: e.userId, name: e.name, checkedIn: e.checkedInAt !== undefined, dropped: dropped.indexOf(e.userId) !== -1 })),
			waitlist: t.waitlist.map((e) => ({ id: e.userId, name: e.name })),
			createdAt: t.createdAt,
			startsAt: t.startsAt,
			startedAt: t.startedAt ?? null,
			finishedAt: t.finishedAt ?? null,
			closed: closedBy(t),
		},
	})
}
