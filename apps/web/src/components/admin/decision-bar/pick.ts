// The pure rules of the decision bar: which action and length are picked,
// what Send says, and when it can be used.
export interface BarLength {
  key: string
  label: string
}

export interface BarAction {
  key: string
  label: string
  // Small text after the label, for example "result stands".
  hint?: string
  destructive?: boolean
  // Lengths to choose from; the first is the default.
  lengths?: BarLength[]
}

export interface BarPick {
  action: string
  length: string | null
}

const lengthLabelOf = (action: BarAction, length: string | null) =>
  action.lengths?.find((l) => l.key === length)?.label ?? null

// The pick a bar opens with: the wanted one if the bar offers it, else the
// first action with its first length.
export function openingPick(
  actions: readonly BarAction[],
  wanted: BarPick | null = null,
): BarPick | null {
  const wantedAction = actions.find((a) => a.key === wanted?.action)
  if (wantedAction && wanted) {
    if (!wantedAction.lengths) return { action: wantedAction.key, length: null }
    const keep = wantedAction.lengths.some((l) => l.key === wanted.length)
    return {
      action: wantedAction.key,
      length: keep ? wanted.length : (wantedAction.lengths[0]?.key ?? null),
    }
  }
  const first = actions[0]
  return first
    ? { action: first.key, length: first.lengths?.[0]?.key ?? null }
    : null
}

// Picking an action keeps the length when the action offers it.
export function pickAction(
  actions: readonly BarAction[],
  current: BarPick | null,
  key: string,
): BarPick | null {
  return openingPick(actions, { action: key, length: current?.length ?? null })
}

// "Chat ban 24h" for the strip and the button.
export function actionTitle(
  actions: readonly BarAction[],
  pick: BarPick,
): string {
  const action = actions.find((a) => a.key === pick.action)
  if (!action) return ''
  const length = lengthLabelOf(action, pick.length)
  return length ? `${action.label} ${length}` : action.label
}

export const cleanNote = (note: string): string => note.trim()

// Send needs a picked action and a written note.
export function canSend(
  actions: readonly BarAction[],
  pick: BarPick | null,
  note: string,
  disabled = false,
): boolean {
  if (disabled || !pick) return false
  if (!actions.some((a) => a.key === pick.action)) return false
  return cleanNote(note).length > 0
}
