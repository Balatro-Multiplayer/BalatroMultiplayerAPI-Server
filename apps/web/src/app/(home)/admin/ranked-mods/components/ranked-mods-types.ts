// A mod is ranked-allowed iff rankedVersion is non-null -- there's no
// separate "allowed" flag (see the server's schema.ts rankedVersion doc
// comment). The catalog itself is synced straight from Thunderstore; the
// admin-owned fields are rankedVersion, featured and hidden.
export interface ModSummary {
  id: string
  title: string
  author: string
  rankedVersion: string | null
  rankedVersionSha256: string | null
  featured: boolean
  hidden: boolean
  thunderstoreFullName: string | null
}

export type ModPatch = Partial<
  Pick<ModSummary, 'rankedVersion' | 'featured' | 'hidden'>
>

export interface ModVersion {
  version: string
  downloadUrl: string
}
