// Pure logic for the Configuration page: what a draft changes against the
// saved value, what the section list shows, and when leaving needs a warning.

export type FeatureFlag =
  | 'chatEnabled'
  | 'rankedEnabled'
  | 'casualQueueEnabled'
  | 'groupQueueEnabled'
  | 'lobbyCreationEnabled'
  | 'achievementsEnabled'

export const FEATURE_FLAG_KEYS: readonly FeatureFlag[] = [
  'chatEnabled',
  'rankedEnabled',
  'casualQueueEnabled',
  'groupQueueEnabled',
  'lobbyCreationEnabled',
  'achievementsEnabled',
]

export interface ModEntry {
  modId: string
  displayName: string
  version: string
  downloadUrl: string
}

export const SECTION_IDS = [
  'flags',
  'ladders',
  'presets',
  'allowlist',
  'mods',
  'notice',
] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const SECTION_TITLES: Record<SectionId, string> = {
  flags: 'Feature flags',
  ladders: 'Strike ladders',
  presets: 'Preset reasons',
  allowlist: 'Chat allowlist',
  mods: 'Official mods',
  notice: 'Notice',
}

// Only the flags a draft turns the other way.
export function changedFlags(
  saved: Record<FeatureFlag, boolean>,
  draft: Record<FeatureFlag, boolean>,
): Partial<Record<FeatureFlag, boolean>> {
  const out: Partial<Record<FeatureFlag, boolean>> = {}
  for (const key of FEATURE_FLAG_KEYS)
    if (saved[key] !== draft[key]) out[key] = draft[key]
  return out
}

export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function allowlistChanges(
  saved: readonly string[],
  draft: readonly string[],
): { add: string[]; remove: string[] } {
  const before = new Set(saved)
  const after = new Set(draft)
  return {
    add: [...after].filter((m) => !before.has(m)),
    remove: [...before].filter((m) => !after.has(m)),
  }
}

export function modChanges(
  saved: readonly ModEntry[],
  draft: readonly ModEntry[],
): { upsert: ModEntry[]; remove: string[] } {
  const before = new Map(saved.map((m) => [m.modId, m]))
  const after = new Set(draft.map((m) => m.modId))
  return {
    upsert: draft.filter((m) => {
      const old = before.get(m.modId)
      return (
        !old ||
        old.displayName !== m.displayName ||
        old.version !== m.version ||
        old.downloadUrl !== m.downloadUrl
      )
    }),
    remove: saved.filter((m) => !after.has(m.modId)).map((m) => m.modId),
  }
}

// A mod form entry replaces a draft entry with the same id.
export function upsertDraftMod(
  draft: readonly ModEntry[],
  mod: ModEntry,
): ModEntry[] {
  const clean = {
    modId: mod.modId.trim(),
    displayName: mod.displayName.trim(),
    version: mod.version.trim(),
    downloadUrl: mod.downloadUrl.trim(),
  }
  return draft.some((m) => m.modId === clean.modId)
    ? draft.map((m) => (m.modId === clean.modId ? clean : m))
    : [...draft, clean]
}

export function addAllowlistMessage(
  draft: readonly string[],
  message: string,
): string[] {
  const text = message.trim()
  return !text || draft.includes(text) ? [...draft] : [...draft, text]
}

export function changeLabel(count: number): string {
  return count === 1 ? '1 change' : `${count} changes`
}

// A save needs at least one change and a note, and waits for one in flight.
export function canSaveSection(
  changeCount: number,
  note: string,
  pending: boolean,
): boolean {
  return !pending && changeCount > 0 && note.trim().length > 0
}

export function flagsSummary(flags: Record<FeatureFlag, boolean>): string {
  const on = FEATURE_FLAG_KEYS.filter((k) => flags[k]).length
  return `${on} of ${FEATURE_FLAG_KEYS.length} on`
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export function laddersSummary(chat: number, play: number): string {
  return `Chat ${plural(chat, 'step', 'steps')}, play ${plural(play, 'step', 'steps')}`
}

export function presetsSummary(types: number, notes: number): string {
  return `${plural(types, 'queue item type', 'queue item types')}, ${plural(notes, 'note', 'notes')}`
}

export function allowlistSummary(count: number): string {
  return plural(count, 'message', 'messages')
}

export function modsSummary(count: number): string {
  return plural(count, 'mod', 'mods')
}

// Picking another section while the open one has unsaved changes asks first.
export function pickSection(
  current: SectionId,
  target: SectionId,
  dirty: boolean,
): { open: SectionId; pending: SectionId | null } {
  if (target === current) return { open: current, pending: null }
  if (dirty) return { open: current, pending: target }
  return { open: target, pending: null }
}
