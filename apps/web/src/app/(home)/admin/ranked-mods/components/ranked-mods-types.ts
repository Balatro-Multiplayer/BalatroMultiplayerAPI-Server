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
  // Admin-set aliases (e.g. "wimf" for "What's in my Fool") matched by the
  // catalog search box alongside name/id - see page.tsx's search filtering.
  searchTerms: string[]
}

export interface ModVersion {
  version: string
}

export interface ModDetail {
  id: string
  title: string
  author: string
  categories: string[]
  searchTerms: string[]
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
  // Comma-separated, same shape as categories - see mod-form-dialog.tsx's
  // field and page.tsx's modFormToFields() for the split/trim.
  searchTerms: string
  requiresSteamodded: boolean
  requiresTalisman: boolean
  repoUrl: string
  thumbnailUrl: string
  description: string
  // sourceType drives what the save payload actually sends (see
  // mod-form-dialog.tsx / page.tsx's modFormToFields): 'branch'/'release'
  // send { sourceInput } and the server resolves latestVersion/
  // latestDownloadUrl itself (see custom-mod-version-check.service.ts's
  // resolveSourceInput) instead of the admin typing a raw URL; 'custom'
  // sends latestVersion/latestDownloadUrl directly, unchanged from before.
  sourceType: ModSourceType
  // Only meaningful when sourceType === 'branch' - see BRANCH_ARCHIVE_RE
  // below for how this gets pre-filled when editing an existing mod.
  branch: string
  latestVersion: string
  latestDownloadUrl: string
  automaticVersionCheck: boolean
}

export const EMPTY_MOD_FORM: ModForm = {
  id: '',
  title: '',
  author: '',
  categories: '',
  searchTerms: '',
  requiresSteamodded: true,
  requiresTalisman: false,
  repoUrl: '',
  thumbnailUrl: '',
  description: '',
  sourceType: 'custom',
  branch: 'main',
  latestVersion: '',
  latestDownloadUrl: '',
  automaticVersionCheck: false,
}

// Mirrors the server's BRANCH_ARCHIVE regex (mod-source-classifier.ts) just
// enough to pull the branch name back out of an existing mod's
// latestDownloadUrl for pre-filling the "Branch name" field when editing -
// the server already tells us sourceType itself (ModDetail.sourceType), so
// this is only needed for the one extra piece 'branch' mode needs beyond that.
const BRANCH_ARCHIVE_RE =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/archive\/refs\/heads\/(.+)\.zip$/

export function extractBranchName(latestDownloadUrl: string | null): string {
  const match = latestDownloadUrl
    ? BRANCH_ARCHIVE_RE.exec(latestDownloadUrl)
    : null
  return match?.[1] ?? 'main'
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
