import type { SeasonEndPlayer } from '../../features/ratings/season-end.js'
import { callNakamaRpc } from './admin-client.js'

// Hands a season's final places to Nakama, which sends each player their
// Notification (nakama/src/notification/season_end.ts). Nakama skips a player
// it already told, so a repeated call after a failure is safe. Returns true
// only when Nakama confirmed every chunk.
const CHUNK = 200
const SEASON_END_TIMEOUT_MS = 60_000

export async function notifySeasonEndInNakama(
	season: { id: number; name: string },
	players: SeasonEndPlayer[],
): Promise<boolean> {
	for (let i = 0; i < players.length; i += CHUNK) {
		const result = await callNakamaRpc(
			'admin_season_end_notify',
			{
				season: season.id,
				name: season.name,
				players: players.slice(i, i + CHUNK),
			},
			{ timeoutMs: SEASON_END_TIMEOUT_MS },
		)
		if (!result.ok) {
			console.warn(
				`[ratings] Season ${season.id} end not sent to players, will retry: ${result.error}`,
			)
			return false
		}
	}
	return true
}
