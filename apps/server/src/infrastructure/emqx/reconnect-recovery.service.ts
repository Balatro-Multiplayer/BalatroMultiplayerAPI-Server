import { kickClient } from './emqx-admin.service.js'

// Small delay between kicks so a boot with many mid-match players doesn't
// slam EMQX with a burst of simultaneous CONNECT/re-auth attempts.
const KICK_STAGGER_MS = 150

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// Forces every player who was mid-active-match at boot (see
// matchmaking.service.ts's getActiveMatchPlayerIds) to reconnect, since an
// app-only restart never actually drops their MQTT session to the separate,
// unrestarted emqx broker -- so nothing client-side would otherwise notice
// anything happened. kickClient already treats "not currently connected" as
// success, so this is safe to call even for a player who already dropped for
// an unrelated reason. The resulting reconnect (backoff MQTT retry, falling
// back to full HTTP re-auth) is what actually restores their session via
// auth.service.ts's reattachRestoredSession.
export async function forceReconnectStalePlayers(playerIds: string[]): Promise<void> {
	if (playerIds.length === 0) return

	console.log(
		`[reconnect-recovery] forcing reconnect for ${playerIds.length} player(s) found mid-active-match at boot`,
	)

	for (const playerId of playerIds) {
		await kickClient(playerId)
		await sleep(KICK_STAGGER_MS)
	}
}
