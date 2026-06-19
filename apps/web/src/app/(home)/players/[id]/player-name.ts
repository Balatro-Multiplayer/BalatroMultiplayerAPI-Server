import { filterGamesBySeason } from '@/shared/seasons'

export const DEFAULT_PLAYER_PROFILE_SEASON = 'season6'

type PlayerNameGame = {
  playerName?: string | null
  season?: string | null
}

export function unescapePlayerName(name: string) {
  return name.replaceAll('\\', '')
}

export function resolvePlayerPageName(
  games: PlayerNameGame[],
  discordUsername: string,
  season = DEFAULT_PLAYER_PROFILE_SEASON
) {
  const seasonGames = filterGamesBySeason(games, season)
  const latestSeasonGame = seasonGames.at(0)

  return latestSeasonGame?.playerName ?? discordUsername
}
