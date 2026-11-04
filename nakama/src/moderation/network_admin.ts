// Network-ban admin RPCs (moderation/network.ts), server to server only, for
// the BMP API's admin panel and its hourly retention job.
import { requireUserId } from '../admin'
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { parsePayload, requireServer } from '../rpc'
import { settingsOf } from '../server_kind'
import {
	isNetworkBanned,
	liftNetworkBan,
	networkBansFor,
	networkHash,
	purgeIpHashes,
} from './network'

// Accounts looked at per call at most; the caller repeats while `more` is set.
export const IP_HASH_PURGE_MAX = 500

// {userId} -> {networkBans}: the network bans the account caused or is
// caught by, lifted ones included.
export function rpcAdminNetworkBans(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const userId = requireUserId(nk, parsePayload(payload))
	return JSON.stringify({ networkBans: networkBansFor(nk, userId) })
}

// {ip} -> {banned}: whether the address is on a banned network. For the
// website, which shows a blocked player that their network is banned. It never
// says which account caused the ban (ADR 0005).
export function rpcAdminNetworkCheck(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const ip = parsePayload(payload).ip
	if (typeof ip !== 'string' || !ip)
		throw runtimeError(INVALID_ARGUMENT, 'ip is required')
	const salt = ctx.env.IP_HASH_SALT
	if (!settingsOf(ctx).networkBans || !salt) return JSON.stringify({ banned: false })
	const hash = networkHash((input) => nk.sha256Hash(input), salt, ip)
	return JSON.stringify({ banned: hash !== null && isNetworkBanned(nk, hash) })
}

// {banId} -> {lifted}: lifted is false when no such network ban is in force.
export function rpcAdminNetworkBanLift(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const banId = parsePayload(payload).banId
	if (typeof banId !== 'string' || !banId)
		throw runtimeError(INVALID_ARGUMENT, 'banId is required')
	const lifted = liftNetworkBan(nk, banId, Date.now())
	if (lifted) logger.info('Lifted network ban %s', banId)
	return JSON.stringify({ lifted })
}

// {} -> {deleted, more}: deletes login hashes 30 days after the last login
// from that network.
export function rpcAdminIpHashesPurge(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const result = purgeIpHashes(nk, Date.now(), IP_HASH_PURGE_MAX)
	if (result.deleted > 0)
		logger.info('Purged %d login network hashes', result.deleted)
	return JSON.stringify(result)
}
