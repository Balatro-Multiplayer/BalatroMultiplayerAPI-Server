import { boardName } from '@bmp/types'
import type { SeasonEndEntry } from '../../infrastructure/gateways/rating.gateway.js'

export interface SeasonEndPlayer {
	userId: string
	boards: { name: string; place: number; rating: number }[]
}

// Groups a season's leaderboard entries by player, one board line each, named
// as the Leaderboards page names the board. A board with no display name is
// left out and returned in `unnamed`, never shown by its key.
export function seasonEndPlayers(entries: SeasonEndEntry[]): {
	players: SeasonEndPlayer[]
	unnamed: string[]
} {
	const byUser = new Map<string, SeasonEndPlayer>()
	const unnamed = new Set<string>()
	const sorted = [...entries].sort(
		(a, b) =>
			a.modId.localeCompare(b.modId) || a.gameMode.localeCompare(b.gameMode),
	)
	for (const entry of sorted) {
		const name = boardName(entry.modId, entry.gameMode)
		if (name === undefined) {
			unnamed.add(`${entry.modId} ${entry.gameMode}`)
			continue
		}
		const player = byUser.get(entry.nakamaUserId) ?? {
			userId: entry.nakamaUserId,
			boards: [],
		}
		player.boards.push({
			name,
			place: entry.place,
			rating: Math.round(entry.rating),
		})
		byUser.set(entry.nakamaUserId, player)
	}
	return { players: [...byUser.values()], unnamed: [...unnamed] }
}
