import type { BanRecord } from '../gateways/ban.gateway.js'
import { findPlayerById } from '../gateways/player.gateway.js'
import type { WarningSource } from '../../shared/service-queue/items.js'
import { type Result, err, ok } from '../../shared/utils/result.js'
import { callNakamaRpc, isNakamaAdminEnabled } from './admin-client.js'

// NotifyCode.WARNED in nakama/src/notify.ts.
const NOTIFY_WARNED = 109

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

// The warning pop-up (WARNED, 109) for a player, kept until they see it.
export async function notifyWarnedInNakama(
	playerId: string,
	payload: { message: string; itemType: WarningSource; warnedAt: number },
): Promise<boolean> {
	const userId = await nakamaUserIdOf(playerId)
	if (!userId) return false
	const result = await callNakamaRpc('admin_notify', {
		userId,
		code: NOTIFY_WARNED,
		subject: 'warned',
		content: payload,
		persistent: true,
	})
	if (!result.ok) console.warn(`[nakama] Warning for ${playerId} not sent: ${result.error}`)
	return result.ok
}

// Tells the player their appeal was decided (admin_punishment_notify). Nakama
// sends it once per appeal.
export async function notifyAppealDecidedInNakama(decided: {
	playerId: string
	appealId: string
	accepted: boolean
	target: string
	result: string | null
}): Promise<boolean> {
	const userId = await nakamaUserIdOf(decided.playerId)
	if (!userId) return false
	const result = await callNakamaRpc('admin_punishment_notify', {
		userId,
		kind: 'appeal_decided',
		key: decided.appealId,
		params: { accepted: decided.accepted, target: decided.target, result: decided.result },
	})
	if (!result.ok) console.warn(`[nakama] Appeal ${decided.appealId} decision not sent: ${result.error}`)
	return result.ok
}

// Tells the player their ban ended (admin_punishment_notify). Nakama sends it
// once per ban, so a repeat after a failure is safe. A player with no Nakama
// account has nobody to tell: that counts as done when Nakama is on.
export async function notifyBanEndedInNakama(ban: {
	id: string
	playerId: string
	banType: string
}): Promise<boolean> {
	if (!isNakamaAdminEnabled()) return false
	const userId = await nakamaUserIdOf(ban.playerId)
	if (!userId) return true
	const result = await callNakamaRpc('admin_punishment_notify', {
		userId,
		kind: 'punishment_ended',
		key: ban.id,
		params: { ban: ban.banType },
	})
	if (!result.ok) console.warn(`[nakama] Ban ${ban.id} end not sent, will retry: ${result.error}`)
	return result.ok
}

// The "action was taken" Notification for the player who made a report.
export async function tellReportActionInNakama(reporterId: string): Promise<boolean> {
	const userId = await nakamaUserIdOf(reporterId)
	if (!userId) return false
	const result = await callNakamaRpc('admin_report_action', { userId })
	if (!result.ok) console.warn(`[nakama] Report action for ${reporterId} not sent: ${result.error}`)
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
	// The Nakama account whose permanent ban made this network ban.
	bannedUserId: string
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
		bannedUserId: b.userId,
		networks: b.networks,
		bannedAt: b.bannedAt,
		liftedAt: b.liftedAt,
	})))
}

// The network bans in force on an address (ADR 0005). Empty when the server has
// no network bans or Nakama cannot answer: the website only uses it to show a
// notice and to keep with an appeal, never to block. Never sent to a player.
export async function networkBanIdsAt(ip: string): Promise<string[]> {
	const result = await callNakamaRpc<{ banned: boolean; banIds?: string[] }>('admin_network_check', { ip })
	return result.ok ? (result.value.banIds ?? []) : []
}

// A network the account logged in from in the last 30 days: a salted hash and
// when it was last seen.
export interface PlayerNetwork {
	hash: string
	lastSeen: number
}

export async function playerNetworksInNakama(playerId: string): Promise<Result<PlayerNetwork[], NetworkBansError>> {
	const userId = await nakamaUserIdOf(playerId)
	if (!userId) return isNakamaAdminEnabled() ? ok([]) : err('unavailable')
	const result = await callNakamaRpc<{ networks: PlayerNetwork[] }>('admin_player_networks', { userId })
	return result.ok ? ok(result.value.networks) : err('unavailable')
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
