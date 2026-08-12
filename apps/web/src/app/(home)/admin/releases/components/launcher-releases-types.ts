export type LauncherPlatform = 'windows' | 'mac' | 'linux'

export interface LauncherReleaseAsset {
  platform: LauncherPlatform
  storagePath: string
  originalFilename: string
  fileSize: number
  sha256: string
}

export interface LauncherRelease {
  id: number
  version: string
  notes: string | null
  createdAt: string
  updatedAt: string
  assets: LauncherReleaseAsset[]
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

// Matches what the launcher's own build pipeline actually produces per
// platform (Inno Setup installer, .dmg, AppImage) -- narrower than the
// server's own ALLOWED_EXTENSIONS, which still tolerates a few legacy
// formats. This is a client-side filter only (the file picker's own
// `accept` attribute), not a validation boundary.
export const PLATFORM_ACCEPT: Record<LauncherPlatform, string> = {
  windows: '.exe',
  mac: '.dmg',
  linux: '.AppImage',
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
