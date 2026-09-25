// A mod is ranked-allowed iff rankedVersion is non-null -- there's no
// separate "allowed" flag (see the server's schema.ts rankedVersion doc
// comment). The whole catalog is synced straight from Thunderstore now, so
// there's nothing else here to edit beyond that one field.
export interface ModSummary {
  id: string
  title: string
  author: string
  rankedVersion: string | null
  rankedVersionSha256: string | null
}

export interface ModVersion {
  version: string
  downloadUrl: string
}
