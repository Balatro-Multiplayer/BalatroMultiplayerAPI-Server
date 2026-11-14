// RPC pvp_protocol: the PvP protocol number this server speaks, so a client
// can tell before it queues. Pure.

// A client refuses to queue or create a lobby when the pvp_protocol RPC is
// missing (an old server) or this number is below its floor. Raise it only
// with a change older clients cannot play.
export const PVP_PROTOCOL = 1

// Empty payload in; {"protocol":<PVP_PROTOCOL>} out.
export function rpcPvpProtocol(
	_ctx: nkruntime.Context,
	_logger: nkruntime.Logger,
	_nk: nkruntime.Nakama,
	_payload: string,
): string {
	return JSON.stringify({ protocol: PVP_PROTOCOL })
}
