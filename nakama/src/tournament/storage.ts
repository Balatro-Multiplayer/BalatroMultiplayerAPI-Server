// Where tournaments live. All system-owned except each player's own list:
//   tournaments        id -> the full record (version-checked writes)
//   tournament_index   id -> its summary, for the Browse list
//   tournament_codes   invite code -> id
//   tournament_due     id -> { at }: when the clock next needs to look at it
//   tournament_mine    (owned by the player) 'list' -> ids they organise,
//                      help run, play in or wait for
// A change is saved in one storageWrite (record + index + the players' lists),
// so they never disagree; a version conflict re-reads and re-applies.
import { ALREADY_EXISTS, NOT_FOUND, RESOURCE_EXHAUSTED, runtimeError } from '../errors'
import { SYSTEM_USER_ID } from '../lobby/protocol'
import { forEachStored } from '../shared/storage'
import type { LifecycleError } from './lifecycle'
import { wakeAt } from './lifecycle'
import type { Tournament } from './model'
import { type TournamentSummary, summaryOf } from './view'
import type { Result } from '../shared/result'

export const TOURNAMENTS = 'tournaments'
export const TOURNAMENT_INDEX = 'tournament_index'
export const TOURNAMENT_CODES = 'tournament_codes'
export const TOURNAMENT_DUE = 'tournament_due'
export const TOURNAMENT_MINE = 'tournament_mine'
const MINE_KEY = 'list'
const MINE_MAX = 100
const SAVE_ATTEMPTS = 4

export interface IndexEntry extends TournamentSummary {
	organiserId: string
	updatedAt: number
	finishedAt: number | null
}

export function readTournament(nk: nkruntime.Nakama, id: string): { t: Tournament; version: string } | null {
	const objects = nk.storageRead([{ collection: TOURNAMENTS, key: id, userId: SYSTEM_USER_ID }])
	if (objects.length === 0) return null
	return { t: objects[0].value as unknown as Tournament, version: objects[0].version ?? '' }
}

function tournamentMemberIds(t: Tournament | null): string[] {
	if (!t) return []
	const ids = [t.organiserId].concat(t.coOrganiserIds, t.entrants.map((e) => e.userId), t.waitlist.map((e) => e.userId))
	// Fake entrants (dev fill) have no account to own a list.
	return ids.filter((id, i) => ids.indexOf(id) === i && !isFakeEntrant(id))
}

export const FAKE_ENTRANT_PREFIX = 'dev-bot-'

export function isFakeEntrant(id: string): boolean {
	return id.indexOf(FAKE_ENTRANT_PREFIX) === 0
}

function readMine(nk: nkruntime.Nakama, userIds: string[]): { [userId: string]: { ids: string[]; version: string | undefined } } {
	const out: { [userId: string]: { ids: string[]; version: string | undefined } } = {}
	for (const id of userIds) out[id] = { ids: [], version: undefined }
	if (userIds.length === 0) return out
	for (const o of nk.storageRead(userIds.map((userId) => ({ collection: TOURNAMENT_MINE, key: MINE_KEY, userId })))) {
		const ids = (o.value as { ids?: unknown }).ids
		out[o.userId] = { ids: Array.isArray(ids) ? (ids as string[]) : [], version: o.version }
	}
	return out
}

export function readMineIds(nk: nkruntime.Nakama, userId: string): string[] {
	return readMine(nk, [userId])[userId].ids
}

function indexEntry(t: Tournament): IndexEntry {
	return { ...summaryOf(t), organiserId: t.organiserId, updatedAt: t.updatedAt, finishedAt: t.finishedAt ?? null }
}

function isVersionConflict(e: unknown): boolean {
	const message = e instanceof Error ? e.message : typeof e === 'object' && e !== null ? String((e as { message?: unknown }).message) : String(e)
	return /version/i.test(message)
}

// Writes `next` (replacing `previous`, read at `version`; both null/undefined
// for a new tournament) with its index entry, due time and the member lists
// it changes. Throws on a version conflict.
function writeTournament(nk: nkruntime.Nakama, previous: Tournament | null, next: Tournament, version: string | undefined) {
	const before = tournamentMemberIds(previous)
	const after = tournamentMemberIds(next)
	const joined = after.filter((id) => before.indexOf(id) === -1)
	const left = before.filter((id) => after.indexOf(id) === -1)
	const lists = readMine(nk, joined.concat(left))
	const writes: nkruntime.StorageWriteRequest[] = [
		{
			collection: TOURNAMENTS,
			key: next.id,
			userId: SYSTEM_USER_ID,
			value: next as unknown as { [key: string]: unknown },
			version: version ?? '*',
			permissionRead: 0,
			permissionWrite: 0,
		},
		{
			collection: TOURNAMENT_INDEX,
			key: next.id,
			userId: SYSTEM_USER_ID,
			value: indexEntry(next) as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
		},
	]
	for (const userId of joined.concat(left)) {
		const list = lists[userId]
		let ids = list.ids.filter((id) => id !== next.id)
		if (joined.indexOf(userId) !== -1) ids = [next.id].concat(ids).slice(0, MINE_MAX)
		writes.push({
			collection: TOURNAMENT_MINE,
			key: MINE_KEY,
			userId,
			value: { ids },
			version: list.version ?? '*',
			permissionRead: 1,
			permissionWrite: 0,
		})
	}
	// Real time: a dev tournament's clock may run ahead (dev.ts time skip).
	const wake = wakeAt(next)
	const due = wake === null ? null : wake - (next.devClockOffsetMs ?? 0)
	if (due !== null) {
		writes.push({ collection: TOURNAMENT_DUE, key: next.id, userId: SYSTEM_USER_ID, value: { at: due }, permissionRead: 0, permissionWrite: 0 })
	}
	nk.storageWrite(writes)
	if (due === null) nk.storageDelete([{ collection: TOURNAMENT_DUE, key: next.id, userId: SYSTEM_USER_ID }])
}

export function insertTournament(nk: nkruntime.Nakama, t: Tournament) {
	writeTournament(nk, null, t, undefined)
}

// Loads, applies `change`, saves; retries from a fresh read on a version
// conflict. Returns the saved tournament, or throws the change's refusal
// as a runtime error.
export function mutate(
	nk: nkruntime.Nakama,
	id: string,
	change: (t: Tournament) => Result<Tournament, LifecycleError> | null,
): Tournament {
	for (let attempt = 1; ; attempt++) {
		const current = readTournament(nk, id)
		if (!current) throw runtimeError(NOT_FOUND, 'No such tournament')
		const result = change(current.t)
		if (result === null) return current.t
		if (!result.ok) throw runtimeError(result.error.code, result.error.message)
		if (result.value === current.t) return current.t
		try {
			writeTournament(nk, current.t, result.value, current.version)
			return result.value
		} catch (e) {
			if (attempt >= SAVE_ATTEMPTS || !isVersionConflict(e)) throw e
		}
	}
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const INVITE_CODE_LENGTH = 6

// Reserves a fresh invite code for tournament `id`.
export function reserveInviteCode(nk: nkruntime.Nakama, id: string, random: () => number = Math.random): string {
	for (let attempt = 0; attempt < 10; attempt++) {
		let code = ''
		for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
		try {
			nk.storageWrite([{ collection: TOURNAMENT_CODES, key: code, userId: SYSTEM_USER_ID, value: { id }, version: '*', permissionRead: 0, permissionWrite: 0 }])
			return code
		} catch (e) {
			// Taken: try another.
		}
	}
	throw runtimeError(ALREADY_EXISTS, 'Could not reserve an invite code')
}

export function tournamentIdForCode(nk: nkruntime.Nakama, code: string): string | null {
	const objects = nk.storageRead([{ collection: TOURNAMENT_CODES, key: code.toUpperCase(), userId: SYSTEM_USER_ID }])
	if (objects.length === 0) return null
	const id = (objects[0].value as { id?: unknown }).id
	return typeof id === 'string' ? id : null
}

export function readIndexEntries(nk: nkruntime.Nakama, ids: string[]): IndexEntry[] {
	if (ids.length === 0) return []
	const objects = nk.storageRead(ids.map((key) => ({ collection: TOURNAMENT_INDEX, key, userId: SYSTEM_USER_ID })))
	const byId: { [id: string]: IndexEntry } = {}
	for (const o of objects) byId[o.key] = o.value as unknown as IndexEntry
	return ids.filter((id) => byId[id]).map((id) => byId[id])
}

// Every index entry matching `keep`, up to `limit`.
export function scanIndex(nk: nkruntime.Nakama, keep: (e: IndexEntry) => boolean, limit: number): IndexEntry[] {
	const out: IndexEntry[] = []
	forEachStored(nk, SYSTEM_USER_ID, TOURNAMENT_INDEX, (o) => {
		const e = o.value as unknown as IndexEntry
		if (keep(e)) out.push(e)
		return out.length >= limit ? 'stop' : undefined
	})
	return out
}

// Ids of tournaments whose due time has come.
export function dueIds(nk: nkruntime.Nakama, now: number): string[] {
	const ids: string[] = []
	forEachStored(nk, SYSTEM_USER_ID, TOURNAMENT_DUE, (o) => {
		const at = (o.value as { at?: unknown }).at
		if (typeof at === 'number' && at <= now) ids.push(o.key)
	})
	return ids
}

// Per-player limit on creating tournaments (and on how many they run at once).
export const CREATE_LIMIT_PER_DAY = 10
export const ACTIVE_LIMIT = 5
const CREATE_LIMIT_COLLECTION = 'limits'
const CREATE_LIMIT_KEY = 'tournament_create_times'
const DAY = 24 * 60 * 60 * 1000

export function spendTournamentCreate(nk: nkruntime.Nakama, userId: string, now: number) {
	const objects = nk.storageRead([{ collection: CREATE_LIMIT_COLLECTION, key: CREATE_LIMIT_KEY, userId }])
	const stored = objects.length > 0 ? (objects[0].value as { times?: unknown }).times : null
	const recent = (Array.isArray(stored) ? (stored as unknown[]) : []).filter((t): t is number => typeof t === 'number' && now - t < DAY)
	if (recent.length >= CREATE_LIMIT_PER_DAY) throw runtimeError(RESOURCE_EXHAUSTED, `You can create at most ${CREATE_LIMIT_PER_DAY} tournaments a day`)
	const active = readIndexEntries(nk, readMineIds(nk, userId)).filter((e) => e.organiserId === userId && e.status !== 'finished' && e.status !== 'cancelled')
	if (active.length >= ACTIVE_LIMIT) throw runtimeError(RESOURCE_EXHAUSTED, `You can run at most ${ACTIVE_LIMIT} tournaments at once`)
	nk.storageWrite([{ collection: CREATE_LIMIT_COLLECTION, key: CREATE_LIMIT_KEY, userId, value: { times: recent.concat([now]) }, permissionRead: 0, permissionWrite: 0 }])
}
