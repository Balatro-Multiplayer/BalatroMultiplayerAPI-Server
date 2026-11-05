import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import {
	checkSeasonRollover,
	listSeasonEndEntries,
	listSeasonsToAnnounce,
	markSeasonAnnounced,
} from '../../infrastructure/gateways/rating.gateway.js'
import { notifySeasonEndInNakama } from '../../infrastructure/nakama/season-sync.js'
import { seasonEndPlayers } from './season-end.js'

// Rolls an expired season over to the next one. Reloading the config pushes
// the new season to Nakama, which rates games into it from then on. Then every
// ended season Nakama has not confirmed yet is announced to its ranked
// players, oldest first. A season stays on that list until Nakama confirms, so
// each run retries it.

export const SEASON_CHECK_INTERVAL_MS = 60 * 60 * 1000

export async function announceEndedSeasons(): Promise<void> {
	for (const season of await listSeasonsToAnnounce()) {
		const { players, unnamed } = seasonEndPlayers(
			await listSeasonEndEntries(season.id),
		)
		if (unnamed.length > 0)
			console.warn(
				`[ratings] Season ${season.id}: boards with no display name left out: ${unnamed.join(', ')}`,
			)
		if (players.length > 0 && !(await notifySeasonEndInNakama(season, players)))
			return
		await markSeasonAnnounced(season.id)
	}
}

export async function rollSeasons(): Promise<number> {
	const rolled = await checkSeasonRollover()
	if (rolled > 0) await loadConfigFromDb()
	await announceEndedSeasons()
	return rolled
}

export function startSeasonJob(): () => void {
	const check = () =>
		void rollSeasons().catch((err) =>
			console.error('[ratings] season rollover failed:', err),
		)
	check()
	const timer = setInterval(check, SEASON_CHECK_INTERVAL_MS)
	timer.unref()
	return () => clearInterval(timer)
}
