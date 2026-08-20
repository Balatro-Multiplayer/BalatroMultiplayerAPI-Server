export type LauncherPlatform = 'windows' | 'mac' | 'linux'

export interface LauncherReleaseAsset {
  platform: LauncherPlatform
  githubAssetId: number
  originalFilename: string
  fileSize: number
  sha256: string
}

export interface LauncherRelease {
  id: number
  version: string
  githubReleaseTag: string
  notes: string | null
  createdAt: string
  updatedAt: string
  assets: LauncherReleaseAsset[]
}

// A GitHub release from new-launcher's own repo, for the admin UI's picker
// (GET /api/webadmin/launcher-releases/github-releases) - not yet imported
// into LauncherRelease until an admin picks one.
export interface GithubReleaseOption {
  tag: string
  name: string | null
  publishedAt: string
  body: string | null
  alreadyImported: boolean
}

export const PLATFORMS: readonly LauncherPlatform[] = [
  'windows',
  'mac',
  'linux',
]

export const PLATFORM_LABELS: Record<LauncherPlatform, string> = {
  windows: 'Windows',
  mac: 'Mac',
  linux: 'Linux',
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}
