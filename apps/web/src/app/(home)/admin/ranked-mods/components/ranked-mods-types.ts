// A mod is ranked-allowed iff rankedVersion is non-null -- there's no
// separate "allowed" flag anymore (see the server's schema.ts rankedVersion
// doc comment). sourceType (mirrors the server's ModSourceType) determines
// what values rankedVersion may even be set to: 'custom' mods can never be
// ranked-allowed; 'branch' mods only to their current latestVersion;
// 'release' mods to any of their known versions.
export type ModSourceType = 'branch' | 'release' | 'custom'

export interface ModSummary {
  id: string
  name: string
  rankedVersion: string | null
  sourceType: ModSourceType
  featured: boolean
  hidden: boolean
  latestVersion: string | null
  thumbnailUrl: string | null
  isCustom: boolean
  overriddenFields: string[]
}

export interface ModVersion {
  version: string
}

export interface ModDetail {
  id: string
  title: string
  author: string
  categories: string[]
  requiresSteamodded: boolean
  requiresTalisman: boolean
  repoUrl: string | null
  thumbnailUrl: string | null
  description: string | null
  latestVersion: string | null
  latestDownloadUrl: string | null
  automaticVersionCheck: boolean
  fixedReleaseTagUpdates: boolean
  isCustom: boolean
  overriddenFields: string[]
  hidden: boolean
  sourceType: ModSourceType
  versions: ModVersion[]
}

export interface ModForm {
  id: string
  title: string
  author: string
  categories: string
  requiresSteamodded: boolean
  requiresTalisman: boolean
  repoUrl: string
  thumbnailUrl: string
  description: string
  latestVersion: string
  latestDownloadUrl: string
  automaticVersionCheck: boolean
  fixedReleaseTagUpdates: boolean
}

export const EMPTY_MOD_FORM: ModForm = {
  id: '',
  title: '',
  author: '',
  categories: '',
  requiresSteamodded: true,
  requiresTalisman: false,
  repoUrl: '',
  thumbnailUrl: '',
  description: '',
  latestVersion: '',
  latestDownloadUrl: '',
  automaticVersionCheck: false,
  fixedReleaseTagUpdates: false,
}

export interface ModProfile {
  id: string
  name: string
  slug: string
  description: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type ModProfileVersionMode = 'exact' | 'latest' | 'latestRanked'

export interface ModProfileEntry {
  id: number
  profileId: string
  modId: string
  versionMode: ModProfileVersionMode
  pinnedVersion: string | null
  allowed: boolean
}

export interface ModProfileDetail extends ModProfile {
  entries: ModProfileEntry[]
}

export interface ProfileForm {
  name: string
  slug: string
  description: string
}

export const EMPTY_PROFILE_FORM: ProfileForm = {
  name: '',
  slug: '',
  description: '',
}
