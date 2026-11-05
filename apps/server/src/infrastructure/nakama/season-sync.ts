import { callNakamaRpc } from './admin-client.js'

// Tells Nakama a season has ended, so it sends each ranked player their
// Notification (nakama/src/notification/season_end.ts). Best effort: a failure
// is logged and the rollover stands, as for bans. Nakama scans the whole
// season, so the call gets a long timeout.
const SEASON_END_TIMEOUT_MS = 120_000

export async function notifySeasonEndInNakama(season: {
	id: number
	name: string
}): Promise<boolean> {
	const result = await callNakamaRpc(
		'admin_season_end_notify',
		{ season: season.id, name: season.name },
		{ timeoutMs: SEASON_END_TIMEOUT_MS },
	)
	if (!result.ok)
		console.warn(
			`[ratings] Season ${season.id} end not sent to players: ${result.error}`,
		)
	return result.ok
}
