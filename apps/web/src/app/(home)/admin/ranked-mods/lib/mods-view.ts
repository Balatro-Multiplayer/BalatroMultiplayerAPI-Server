import type {
  ModProfile,
  ModSummary,
} from '../components/ranked-mods-types'

export type ModFilter =
  | 'pinned'
  | 'all'
  | 'custom'
  | 'featured'
  | 'hidden'
  | 'unavailable'

export const MOD_FILTERS: { key: ModFilter; label: string }[] = [
  { key: 'pinned', label: 'Pinned' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
  { key: 'featured', label: 'Featured' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'unavailable', label: 'Unavailable' },
]

const MATCH: Record<ModFilter, (m: ModSummary) => boolean> = {
  pinned: (m) => m.rankedVersion !== null,
  all: () => true,
  custom: (m) => m.isCustom,
  featured: (m) => m.featured,
  hidden: (m) => m.hidden,
  unavailable: (m) => m.rankedDownloadStatus === 'unavailable',
}

export function filterCounts(mods: ModSummary[]): Record<ModFilter, number> {
  const counts = {} as Record<ModFilter, number>
  for (const { key } of MOD_FILTERS) {
    counts[key] = mods.filter(MATCH[key]).length
  }
  return counts
}

// Pinned mods first, then by title, so the mods that matter sit on top.
export function filterMods(
  mods: ModSummary[],
  filter: ModFilter,
  search: string
): ModSummary[] {
  const q = search.trim().toLowerCase()
  return mods
    .filter(MATCH[filter])
    .filter(
      (m) =>
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.author.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
    )
    .sort(
      (a, b) =>
        Number(b.rankedVersion !== null) - Number(a.rankedVersion !== null) ||
        a.title.localeCompare(b.title)
    )
}

// What deleting a mod changes: its pin and SMODS ids leave the allowed list,
// and it leaves every profile that names it.
export function modDeleteImpact(mod: ModSummary, profiles: ModProfile[]) {
  const pinned = mod.rankedVersion !== null
  return {
    pinnedVersion: mod.rankedVersion,
    allowedIds: pinned ? mod.smodsIds : [],
    profiles: profiles.filter((p) => p.entries.some((e) => e.modId === mod.id)),
  }
}

// What deleting a profile changes: the launcher stops offering it. Mods and
// the allowed list stay as they are.
export function profileDeleteImpact(profile: ModProfile, mods: ModSummary[]) {
  const titles = new Map(mods.map((m) => [m.id, m.title]))
  return {
    modTitles: profile.entries.map((e) => titles.get(e.modId) ?? e.modId),
  }
}
