export interface ModSummary {
  id: string
  name: string
  allowedInRanked: boolean
  rankedVersion: string | null
  featured: boolean
  latestVersion: string | null
  thumbnailUrl: string | null
  isCustom: boolean
  overriddenFields: string[]
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
  isCustom: boolean
  overriddenFields: string[]
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
