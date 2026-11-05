// What the service queue gives the decision bar: the buttons the server
// allows for this item and role, the lengths, and the step the strike ladder
// recommends. Pure: the bar component holds the state.
import type {
  BarAction,
  BarLength,
  BarPick,
} from '@/components/admin/decision-bar/pick'
import type {
  Ladder,
  LadderStep,
  StrikeSummary,
} from '../../players/lib/strikes'
import { defaultLadder } from './action-form'
import { ACTION_LABELS, DISMISS_LABEL_TEXT, DURATION_LABELS } from './format'
import type {
  ActionKey,
  AllowedAction,
  DismissLabel,
  Duration,
  ItemDetail,
} from './types'

export const APPEAL_PREFIX = 'appeal:'
export const DISMISS_PREFIX = 'dismiss:'

export type AppealMode = 'deny' | 'lift' | 'shorten'

export const APPEAL_LABELS: Record<AppealMode, string> = {
  deny: 'Deny appeal',
  lift: 'Grant: lift punishment',
  shorten: 'Grant: shorten ban',
}

const APPEAL_LENGTHS: BarLength[] = (['24h', '7d', '30d'] as const).map(
  (d) => ({
    key: d,
    label: DURATION_LABELS[d],
  })
)

const lengthsOf = (presets: Duration[]): BarLength[] =>
  presets.map((d) => ({ key: d, label: DURATION_LABELS[d] }))

// unban needs a ban to lift; every other allowed action is shown as given.
const isUsable = (allowed: AllowedAction, detail: ItemDetail) =>
  allowed.action !== 'unban' || (detail.subject?.bans.active.length ?? 0) > 0

// The bar's buttons. A flagged chat item has 2 dismiss buttons in place of
// one; an open appeal has its own decisions in place of the actions.
export function barActionsOf(detail: ItemDetail): BarAction[] {
  if (detail.item.itemType === 'appeal' && detail.item.status === 'open') {
    const d = detail.appealDecisions
    const evidence = detail.evidence as {
      target?: string
      punishment?: { expiresAt: string | null } | null
    } | null
    const canShorten =
      evidence?.target === 'ban' && evidence.punishment?.expiresAt != null
    const modes: AppealMode[] = [
      ...(d?.deny ? (['deny'] as const) : []),
      ...(d?.grant ? (['lift'] as const) : []),
      ...(d?.grant && canShorten ? (['shorten'] as const) : []),
    ]
    return modes.map((m) => ({
      key: APPEAL_PREFIX + m,
      label: APPEAL_LABELS[m],
      destructive: m === 'deny',
      lengths: m === 'shorten' ? APPEAL_LENGTHS : undefined,
    }))
  }
  return detail.allowedActions
    .filter((a) => isUsable(a, detail))
    .flatMap((a): BarAction[] => {
      if (a.action === 'dismiss' && detail.item.itemType === 'flagged_chat')
        return (['not_harmful', 'harmful_no_action'] as const).map((l) => ({
          key: DISMISS_PREFIX + l,
          label: DISMISS_LABEL_TEXT[l].button,
        }))
      return [
        {
          key: a.action,
          label: ACTION_LABELS[a.action],
          destructive: a.destructive,
          lengths: a.presets?.length ? lengthsOf(a.presets) : undefined,
        },
      ]
    })
}

// A bar key back to the server's action and, for a flagged chat dismiss, the label.
export function actionOfKey(key: string): {
  action: ActionKey
  dismissLabel: DismissLabel | null
} {
  if (key.startsWith(DISMISS_PREFIX))
    return {
      action: 'dismiss',
      dismissLabel: key.slice(DISMISS_PREFIX.length) as DismissLabel,
    }
  return { action: key as ActionKey, dismissLabel: null }
}

// The ladder an item's punishments count on, for the warning step.
export const ladderOfItem = (itemType: string): Ladder =>
  defaultLadder('warn', itemType)

// The ladder a button's punishment counts on, or null for a button that is no
// strike.
export function ladderOfKey(key: string, itemType: string): Ladder | null {
  if (key === 'warn') return ladderOfItem(itemType)
  if (key === 'chat_mute') return 'chat'
  if (key === 'queue_ban') return 'play'
  return null
}

// The step a pick applies on its ladder: a warning, or the length picked.
export function stepOfPick(pick: BarPick): LadderStep | null {
  if (pick.action === 'warn') return 'warning'
  if (pick.action === 'chat_mute' || pick.action === 'queue_ban')
    return pick.length as LadderStep | null
  return null
}

// The pick for the ladder's next step on this item: the warning, or the chat
// ban (chat ladder) or queue ban (play ladder) with the recommended length.
// Null when the bar has no such button, so the bar opens on its first one.
export function recommendedPick(
  itemType: string,
  actions: readonly BarAction[],
  strikes: StrikeSummary | undefined
): BarPick | null {
  if (!strikes) return null
  const ladder = ladderOfItem(itemType)
  const step = strikes[ladder].recommended
  if (step === 'warning')
    return actions.some((a) => a.key === 'warn')
      ? { action: 'warn', length: null }
      : null
  const key = ladder === 'chat' ? 'chat_mute' : 'queue_ban'
  const action = actions.find((a) => a.key === key)
  return action?.lengths?.some((l) => l.key === step)
    ? { action: key, length: step }
    : null
}

// The ladder's step for the player the punishment lands on, when it differs
// from what staff picked: they must say why.
export function deviatesFrom(
  pick: BarPick | null,
  itemType: string,
  strikes: StrikeSummary | undefined
): LadderStep | null {
  if (!pick || !strikes) return null
  const ladder = ladderOfKey(pick.action, itemType)
  const applied = stepOfPick(pick)
  if (!ladder || !applied) return null
  const recommended = strikes[ladder].recommended
  return applied === recommended ? null : recommended
}
