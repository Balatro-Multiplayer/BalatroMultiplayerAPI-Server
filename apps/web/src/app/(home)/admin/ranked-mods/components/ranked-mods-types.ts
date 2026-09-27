// A mod is ranked-allowed iff rankedVersion is non-null -- there's no
// separate "allowed" flag (see the server's schema.ts rankedVersion doc
// comment). Most of the catalog is synced straight from Thunderstore and
// read-only here (only the ranked pin, featured, hidden and trackGithub are
// editable); isCustom rows are admin-created and fully editable.
export type ModSourceType = 'branch' | 'release' | 'custom'

// Where a version comes from, which also decides how it deploys:
// 'thunderstore' as shipped, 'github' through the canonical flatten.
export type VersionSource = 'thunderstore' | 'github'

export interface ModSummary {
  id: string
  title: string
  author: string
  rankedVersion: string | null
  rankedVersionSha256: string | null
  // The pin's permanent download, fixed at pin time; only an admin re-pin
  // changes it. rankedDownloadStatus is the sync's health check -- the
  // server never clears a pin itself, it flags it 'unavailable' for an admin.
  rankedDownloadUrl: string | null
  rankedSource: VersionSource | null
  rankedDownloadStatus: 'ok' | 'unavailable' | null
  featured: boolean
  hidden: boolean
  thunderstoreFullName: string | null
  isCustom: boolean
  // Always true for a custom mod.
  trackGithub: boolean
  sourceType: ModSourceType
}

export type ModPatch = Partial<
  Pick<ModSummary, 'rankedVersion' | 'featured' | 'hidden' | 'trackGithub'>
> & { rankedCommit?: string }

// One entry of a mod's merged version list (GET /webadmin/mods/:id/versions),
// Thunderstore versions first.
export interface ModVersion {
  version: string
  source: VersionSource
  aliases: string[]
  ref: string | null
  downloadUrl: string | null
  releasedAt: string | null
}

// The subset of GET /webadmin/mods/:id the edit dialog prefills from.
export interface ModDetail extends ModSummary {
  categories: string[]
  searchTerms: string[]
  repoUrl: string | null
  thumbnailUrl: string | null
  description: string | null
  latestVersion: string | null
  latestDownloadUrl: string | null
  automaticVersionCheck: boolean
}

// Text-field state for the custom-mod dialog. Lists are comma-separated.
export interface ModForm {
  id: string
  title: string
  author: string
  categories: string
  searchTerms: string
  repoUrl: string
  thumbnailUrl: string
  description: string
  sourceType: ModSourceType
  branch: string
  latestVersion: string
  latestDownloadUrl: string
  automaticVersionCheck: boolean
}

export const emptyModForm: ModForm = {
  id: '',
  title: '',
  author: '',
  categories: '',
  searchTerms: '',
  repoUrl: '',
  thumbnailUrl: '',
  description: '',
  sourceType: 'release',
  branch: '',
  latestVersion: '',
  latestDownloadUrl: '',
  automaticVersionCheck: false,
}

const BRANCH_ARCHIVE_BRANCH = /\/archive\/refs\/heads\/(.+)\.zip$/

export function formFromDetail(mod: ModDetail): ModForm {
  return {
    id: mod.id,
    title: mod.title,
    author: mod.author,
    categories: mod.categories.join(', '),
    searchTerms: mod.searchTerms.join(', '),
    repoUrl: mod.repoUrl ?? '',
    thumbnailUrl: mod.thumbnailUrl ?? '',
    description: mod.description ?? '',
    sourceType: mod.sourceType,
    branch: BRANCH_ARCHIVE_BRANCH.exec(mod.latestDownloadUrl ?? '')?.[1] ?? '',
    latestVersion: mod.latestVersion ?? '',
    latestDownloadUrl: mod.latestDownloadUrl ?? '',
    automaticVersionCheck: mod.automaticVersionCheck,
  }
}

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

const orNull = (s: string) => (s.trim() === '' ? null : s.trim())

// Request body for POST /webadmin/mods (create) and PUT /webadmin/mods/:id/custom
// (edit). A branch/release source is re-resolved from GitHub by the server
// (sourceInput); on edit it is only sent when the admin actually changed the
// source, so an unrelated edit never re-resolves or moves the version. A
// custom source sends the URL/version directly.
export function formToBody(
  form: ModForm,
  mode: 'create' | 'edit',
  initial: ModForm
) {
  const body: Record<string, unknown> = {
    title: form.title.trim(),
    author: form.author.trim(),
    categories: splitList(form.categories),
    searchTerms: splitList(form.searchTerms),
    repoUrl: orNull(form.repoUrl),
    thumbnailUrl: orNull(form.thumbnailUrl),
    description: orNull(form.description),
  }
  if (mode === 'create') body.id = form.id.trim()

  if (form.sourceType === 'custom') {
    body.latestVersion = orNull(form.latestVersion)
    body.latestDownloadUrl = orNull(form.latestDownloadUrl)
    body.automaticVersionCheck = form.automaticVersionCheck
  } else {
    const sourceChanged =
      mode === 'create' ||
      form.sourceType !== initial.sourceType ||
      form.repoUrl !== initial.repoUrl ||
      form.branch !== initial.branch
    if (sourceChanged) {
      body.sourceInput =
        form.sourceType === 'branch'
          ? {
              sourceType: 'branch',
              repoUrl: form.repoUrl.trim(),
              branch: form.branch.trim(),
            }
          : { sourceType: 'release', repoUrl: form.repoUrl.trim() }
    }
  }
  return body
}
