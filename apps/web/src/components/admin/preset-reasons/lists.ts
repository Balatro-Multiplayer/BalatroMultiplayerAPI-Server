// Preset reasons on the web: the lists as the server sends them, and the pure
// edits the Configuration page makes to one list before it saves.

export const MAX_PRESET_REASONS = 20
export const MAX_PRESET_LENGTH = 200

export const presetReasonsKey = ['admin-preset-reasons'] as const

export function moveReason(
  list: readonly string[],
  index: number,
  by: -1 | 1
): string[] {
  const to = index + by
  if (to < 0 || to >= list.length) return [...list]
  const next = list.filter((_, i) => i !== index)
  next.splice(to, 0, list[index] as string)
  return next
}

export function removeReason(list: readonly string[], index: number): string[] {
  return list.filter((_, i) => i !== index)
}

export function editReason(
  list: readonly string[],
  index: number,
  text: string
): string[] {
  return list.map((t, i) => (i === index ? text : t))
}

export const addReason = (list: readonly string[], text: string): string[] => [
  ...list,
  text.trim(),
]

// What stops a list from being saved, or null. The server checks the same.
export function listProblem(list: readonly string[]): string | null {
  if (list.length > MAX_PRESET_REASONS)
    return `At most ${MAX_PRESET_REASONS} preset reasons.`
  const seen = new Set<string>()
  for (const raw of list) {
    const text = raw.trim()
    if (!text) return 'A preset reason cannot be empty.'
    if (text.length > MAX_PRESET_LENGTH)
      return `A preset reason is over ${MAX_PRESET_LENGTH} characters.`
    if (seen.has(text)) return 'A preset reason is listed twice.'
    seen.add(text)
  }
  return null
}

export function isChanged(
  saved: readonly string[],
  draft: readonly string[]
): boolean {
  return (
    saved.length !== draft.length || saved.some((text, i) => text !== draft[i])
  )
}

export function canSaveList(
  saved: readonly string[],
  draft: readonly string[],
  note: string,
  pending: boolean
): boolean {
  return (
    !pending &&
    note.trim().length > 0 &&
    isChanged(saved, draft) &&
    listProblem(draft) === null
  )
}
