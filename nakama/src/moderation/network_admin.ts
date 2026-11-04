// Network-ban admin RPCs (moderation/network.ts), server to server only, for
// the BMP API's admin panel and its hourly retention job.
import { requireUserId } from '../admin'
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { parsePayload, requireServer } from '../rpc'
import {
	liftNetworkBan,
	networkBansFor,
	purgeIpHashes,
	readIpHashes,
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

// {userId} -> {networks}: the salted hashes of the networks the account
// logged in from in the last 30 days, each with the time of its last login.
// For admins only; the hashes are never sent to moderators.
export function rpcAdminPlayerNetworks(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const userId = requireUserId(nk, parsePayload(payload))
	const hashes = readIpHashes(nk, userId)
	const networks = Object.keys(hashes).map((hash) => ({
		hash,
		lastSeen: hashes[hash],
	}))
	return JSON.stringify({ networks })
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
