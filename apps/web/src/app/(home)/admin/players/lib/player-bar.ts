// What the player page gives the decision bar: the buttons for the role, the
// length the strike ladder recommends, and the request a pick turns into.
// Pure: the page holds the state.
import type {
  BarAction,
  BarLength,
  BarPick,
} from '@/components/admin/decision-bar/pick'
import type { Ladder, LadderStep, StrikeSummary } from './strikes'

export const PLAYER_ACTIONS = [
  'note',
  'warn',
  'chat_ban',
  'queue_ban',
  'account_ban',
  'lift',
] as const
export type PlayerAction = (typeof PLAYER_ACTIONS)[number]
export const isPlayerAction = (key: string): key is PlayerAction =>
  (PLAYER_ACTIONS as readonly string[]).includes(key)

export type BanLength = '24h' | '7d' | '30d' | 'permanent'

const LENGTH_LABELS: Record<BanLength, string> = {
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  permanent: 'Permanent',
}
const HOURS: Record<Exclude<BanLength, 'permanent'>, number> = {
  '24h': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
}
const lengths = (keys: BanLength[]): BarLength[] =>
  keys.map((key) => ({ key, label: LENGTH_LABELS[key] }))

const ACTION_LABEL: Record<PlayerAction, string> = {
  note: 'Add note',
  warn: 'Warn',
  chat_ban: 'Chat ban',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
  lift: 'Lift',
}

// A moderator issues chat and queue bans; an admin also bans accounts and
// lifts bans and warnings (there must be one to lift).
export function playerBarActions(
  isAdmin: boolean,
  canLift: boolean,
): BarAction[] {
  const all: BarAction[] = [
    { key: 'note', label: ACTION_LABEL.note },
    { key: 'warn', label: ACTION_LABEL.warn },
    {
      key: 'chat_ban',
      label: ACTION_LABEL.chat_ban,
      destructive: true,
      lengths: lengths(['24h', '7d', '30d', 'permanent']),
    },
    {
      key: 'queue_ban',
      label: ACTION_LABEL.queue_ban,
      destructive: true,
      lengths: lengths(['24h', '7d', '30d', 'permanent']),
    },
  ]
  if (isAdmin)
    all.push({
      key: 'account_ban',
      label: ACTION_LABEL.account_ban,
      destructive: true,
      lengths: lengths(['permanent', '30d', '7d', '24h']),
    })
  if (isAdmin && canLift) all.push({ key: 'lift', label: ACTION_LABEL.lift })
  return all
}

export const ladderOfAction = (action: string): Ladder | null =>
  action === 'chat_ban' ? 'chat' : action === 'queue_ban' ? 'play' : null

// The pick a button opens: a ban opens on the length the ladder recommends
// (24h when the next step is only a warning).
export function wantedPick(
  action: PlayerAction,
  strikes: StrikeSummary | undefined,
): BarPick {
  const ladder = ladderOfAction(action)
  if (!ladder) return { action, length: null }
  const step = strikes?.[ladder].recommended
  return { action, length: step && step !== 'warning' ? step : '24h' }
}

// The step a pick applies, on the ladder it counts on.
function appliedStep(pick: BarPick, warnLadder: Ladder) {
  if (pick.action === 'warn')
    return { ladder: warnLadder, step: 'warning' as LadderStep }
  const ladder = ladderOfAction(pick.action)
  return ladder ? { ladder, step: pick.length as LadderStep } : null
}

// The ladder's step when it differs from the pick: the note then says why.
export function deviatesFrom(
  pick: BarPick | null,
  warnLadder: Ladder,
  strikes: StrikeSummary | undefined,
): LadderStep | null {
  if (!pick || !strikes) return null
  const applied = appliedStep(pick, warnLadder)
  if (!applied) return null
  const recommended = strikes[applied.ladder].recommended
  return applied.step === recommended ? null : recommended
}

export type LiftTarget = { kind: 'ban' | 'warning'; id: string }

export interface PlayerRequest {
  method: 'POST' | 'DELETE'
  path: string
  body: Record<string, unknown>
}

export type RequestResult =
  | { ok: true; request: PlayerRequest }
  | { ok: false; missing: string }

export function expiryOf(length: BanLength, now: number): string | null {
  if (length === 'permanent') return null
  return new Date(now + HOURS[length] * 3_600_000).toISOString()
}

// The request a pick makes, or what is still missing from it. `endsOn` is an
// admin's own end date for a ban; it wins over the length.
export function requestFor(input: {
  playerId: string
  pick: BarPick
  note: string
  warning: { message: string; ladder: Ladder }
  endsOn: string
  isAdmin: boolean
  lift: LiftTarget | null
  strikes: StrikeSummary | undefined
  now: number
}): RequestResult {
  const { playerId, pick, note } = input
  const base = `/webadmin/players/${playerId}`
  if (!isPlayerAction(pick.action))
    return { ok: false, missing: 'Pick an action.' }
  const action = pick.action
  if (action === 'note')
    return {
      ok: true,
      request: { method: 'POST', path: `${base}/notes`, body: { note } },
    }
  if (action === 'lift') {
    if (!input.lift) return { ok: false, missing: 'Pick what to lift.' }
    const { kind, id } = input.lift
    return {
      ok: true,
      request: {
        method: 'DELETE',
        path: `${base}/${kind === 'ban' ? 'bans' : 'warnings'}/${id}`,
        body: { reason: note },
      },
    }
  }
  const deviates = deviatesFrom(pick, input.warning.ladder, input.strikes)
  const deviationReason = deviates ? note : undefined
  if (action === 'warn') {
    const message = input.warning.message.trim()
    if (!message) return { ok: false, missing: 'Write the warning.' }
    return {
      ok: true,
      request: {
        method: 'POST',
        path: `${base}/warnings`,
        body: {
          message,
          reason: note,
          ladder: input.warning.ladder,
          deviationReason,
        },
      },
    }
  }
  const type = action === 'chat_ban' ? 'chat' : action === 'queue_ban' ? 'queue' : 'account'
  const ladder = ladderOfAction(action)
  const expiresAt =
    input.isAdmin && input.endsOn
      ? new Date(input.endsOn).toISOString()
      : expiryOf((pick.length ?? 'permanent') as BanLength, input.now)
  return {
    ok: true,
    request: {
      method: 'POST',
      path: `${base}/bans`,
      body: {
        type,
        reason: note,
        expiresAt,
        ...(ladder ? { ladder, deviationReason } : {}),
      },
    },
  }
}
