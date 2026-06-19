import { createFromSource } from 'fumadocs-core/search/server'
import { LeaderboardService } from '@/server/services/leaderboard'
import { RANKED_QUEUE_ID } from '@/shared/constants'
import type { PlayerSearchResult, SearchResult } from '@/types/search'
import { source } from '../../../../lib/source'

const leaderboardService = new LeaderboardService()
type FumadocsResult = {
  id: string
  url: string
  content: string
  type: 'page' | 'heading' | 'text'
}

// Create the default fumadocs search handler
const fumadocsSearch = createFromSource(source)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('query') ?? ''

    // Get fumadocs results
    const fumadocsResponse = await fumadocsSearch.GET(request)
    const fumadocsData = (await fumadocsResponse.json()) as FumadocsResult[]

    // Get leaderboard players - search by name or discord ID
    let playerResults: PlayerSearchResult[] = []

    if (query.trim()) {
      try {
        // Get full leaderboard dataset with search filter but no pagination
        const leaderboard = await leaderboardService.getLeaderboard(
          RANKED_QUEUE_ID,
          {
            search: query,
          }
        )

        // Take top 10 matches
        playerResults = leaderboard.data.slice(0, 10).map((player) => ({
          type: 'player' as const,
          username: player.name,
          discord_id: player.id,
          ranked_mmr: player.mmr,
          url: `/players/${player.id}`,
        }))
      } catch (error) {
        console.error('Error searching leaderboard:', error)
        // Continue without player results if search fails
      }
    }
    // Merge results - fumadocs results first, then player results
    const combinedResults: SearchResult[] = [
      ...fumadocsData.map((result) => ({
        type: 'doc' as const,
        id: result.id,
        url: result.url,
        content: result.content,
        docType: result.type,
      })),
      ...playerResults,
    ]

    return Response.json(combinedResults)
  } catch (error) {
    console.error('Search error:', error)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }
}
