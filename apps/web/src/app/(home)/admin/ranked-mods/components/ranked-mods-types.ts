export interface ModSummary {
  id: string
  name: string
  allowedInRanked: boolean
  latestVersion: string | null
  thumbnailUrl: string | null
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
