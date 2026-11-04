import type { BanRecord } from '../gateways/ban.gateway.js'
import { findPlayerById } from '../gateways/player.gateway.js'
import { type Result, err, ok } from '../../shared/utils/result.js'
import { callNakamaRpc, isNakamaAdminEnabled } from './admin-client.js'

// Bans and webadmin lobby actions reaching players on Nakama
// (nakama/src/admin.ts). Postgres stays the ban history; Nakama keeps the bans
// in force and acts on them at once. Best effort: a failure is logged, and the
// ban is still in Postgres for the next player sync.

export async function nakamaUserIdOf(playerId: string): Promise<string | null> {
	if (!isNakamaAdminEnabled()) return null
	const player = await findPlayerById(playerId)
	return player?.nakamaUserId ?? null
}

export async function banInNakama(ban: BanRecord): Promise<boolean> {
	const userId = await nakamaUserIdOf(ban.playerId)
	if (!userId) return false
	const result = await callNakamaRpc('admin_ban_apply', {
		userId,
		type: ban.banType,
		banId: ban.id,
		expiresAt: ban.expiresAt ? ban.expiresAt.getTime() : null,
		reason: ban.reason,
	})
	if (!result.ok) console.warn(`[nakama] Ban ${ban.id} not applied: ${result.error}`)
	return result.ok
}

export async function liftBanInNakama(playerId: string, banId: string): Promise<boolean> {
	const userId = await nakamaUserIdOf(playerId)
	if (!userId) return false
	const result = await callNakamaRpc('admin_ban_lift', { userId, banId })
	if (!result.ok) console.warn(`[nakama] Ban ${banId} not lifted: ${result.error}`)
	return result.ok
}

// A network ban (ADR 0005) as the admin panel shows it. own: it came from this
// player's own permanent account ban; otherwise it covers a network this
// player logged in from.
export interface NetworkBanSummary {
	banId: string
	own: boolean
	networks: number
	bannedAt: number
	liftedAt: number | null
}

// unavailable: Nakama cannot answer (off, or not reached).
export type NetworkBansError = 'unavailable'

// The network bans that touch a player. Only the Official server has network
// bans; elsewhere the list is empty.
export async function networkBansInNakama(playerId: string): Promise<Result<NetworkBanSummary[], NetworkBansError>> {
	const userId = await nakamaUserIdOf(playerId)
	if (!userId) return isNakamaAdminEnabled() ? ok([]) : err('unavailable')
	const result = await callNakamaRpc<{
		networkBans: { banId: string; userId: string; networks: number; bannedAt: number; liftedAt: number | null }[]
	}>('admin_network_bans', { userId })
	if (!result.ok) return err('unavailable')
	return ok(result.value.networkBans.map((b) => ({
		banId: b.banId,
		own: b.userId === userId,
		networks: b.networks,
		bannedAt: b.bannedAt,
		liftedAt: b.liftedAt,
	})))
}

// Whether an address is on a banned network. False when the server has no
// network bans or Nakama cannot answer: the website only uses it to show a
// notice, never to block.
export async function isNetworkBannedInNakama(ip: string): Promise<boolean> {
	const result = await callNakamaRpc<{ banned: boolean }>('admin_network_check', { ip })
	return result.ok && result.value.banned
}

// not_found: no such network ban in force. unavailable: Nakama cannot answer.
export type NetworkBanLiftError = 'not_found' | 'unavailable'

export async function liftNetworkBanInNakama(banId: string): Promise<Result<null, NetworkBanLiftError>> {
	const result = await callNakamaRpc<{ lifted: boolean }>('admin_network_ban_lift', { banId })
	if (!result.ok) return err('unavailable')
	return result.value.lifted ? ok(null) : err('not_found')
}

export interface NakamaLobbySummary {
	code: string
	modId: string
	type: 'public' | 'private'
	mode: string
	started: boolean
	size: number
	max: number
	matchId: string
}

export interface NakamaLobbyDetail {
	code: string
	modId: string
	hostId: string
	maxPlayers: number
	createdAt: number
	metadata: Record<string, unknown>
	started: boolean
	players: { id: string; displayName: string; connected: boolean }[]
	spectators: string[]
	matchId: string
}

// [] when Nakama is off or unreachable.
export async function listNakamaLobbies(): Promise<NakamaLobbySummary[]> {
	if (!isNakamaAdminEnabled()) return []
	const result = await callNakamaRpc<{ lobbies: NakamaLobbySummary[] }>('admin_lobby_list', {})
	if (!result.ok) return []
	return result.value.lobbies.filter((l) => typeof l.code === 'string' && l.code !== '')
}

export async function getNakamaLobby(code: string): Promise<NakamaLobbyDetail | null> {
	if (!isNakamaAdminEnabled()) return null
	const result = await callNakamaRpc<{ lobby: NakamaLobbyDetail }>('admin_lobby_get', { code })
	return result.ok ? result.value.lobby : null
}

// playerId may be a Postgres player id or a Nakama user id.
export async function kickFromNakamaLobby(code: string, playerId: string, reason: string): Promise<boolean> {
	if (!isNakamaAdminEnabled()) return false
	const userId = (await findPlayerById(playerId).catch(() => null))?.nakamaUserId ?? playerId
	const result = await callNakamaRpc('admin_lobby_kick', { code, userId, reason })
	return result.ok
}

export async function closeNakamaLobby(code: string): Promise<boolean> {
	if (!isNakamaAdminEnabled()) return false
	const result = await callNakamaRpc('admin_lobby_close', { code })
	return result.ok
}
