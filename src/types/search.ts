// Search result types for combined docs + player search

export type DocSearchResult = {
  type: 'doc'
  id: string
  url: string
  content: string
  docType: 'page' | 'heading' | 'text'
}

export type PlayerSearchResult = {
  type: 'player'
  username: string
  discord_id: string
  ranked_mmr: number
  avatar?: string
  url: string
}

export type SearchResult = DocSearchResult | PlayerSearchResult
