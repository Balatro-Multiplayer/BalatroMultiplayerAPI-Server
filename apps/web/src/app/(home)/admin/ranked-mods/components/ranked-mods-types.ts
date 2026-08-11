export interface ModSummary {
  id: string
  name: string
  allowedInRanked: boolean
  rankedVersion: string | null
  latestVersion: string | null
  thumbnailUrl: string | null
  isCustom: boolean
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

export interface ModProfileEntry {
  id: number
  profileId: string
  modId: string
  versionConstraint: string
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
