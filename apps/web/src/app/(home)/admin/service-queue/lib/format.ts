// Pure wording for the queue: labels, durations, ages, and who someone is.
import type {
  ActionEffects,
  ActionKey,
  DismissLabel,
  Duration,
  ItemDetail,
  ItemEventKind,
  ItemType,
  LobbyKind,
  RefusalCode,
  TargetRole,
} from './types'

export const TYPE_LABELS: Record<ItemType, string> = {
  report: 'Report',
  flagged_chat: 'Flagged chat',
  match_conflict: 'Match result',
  forfeit_reconciliation: 'Forfeit',
  contest: 'Contest',
  anti_cheat: 'Anti-cheat',
  integrity: 'Integrity',
}

// The tab strip's order and wording.
export const TYPE_TABS: { type: ItemType | null; label: string }[] = [
  { type: null, label: 'All' },
  { type: 'report', label: 'Reports' },
  { type: 'flagged_chat', label: 'Chat' },
  { type: 'match_conflict', label: 'Match results' },
  { type: 'forfeit_reconciliation', label: 'Forfeits' },
  { type: 'contest', label: 'Contests' },
]

// Items the server raises on its own; they have the Automatic tab.
export const AUTOMATIC_TYPES: readonly ItemType[] = ['anti_cheat', 'integrity']

export const ACTION_LABELS: Record<ActionKey, string> = {
  dismiss: 'Dismiss',
  resolve: 'Resolve',
  warn: 'Warn',
  chat_mute: 'Chat mute',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
  void: 'Void match',
  overturn: 'Overturn',
  reopen: 'Reopen',
  unban: 'Lift ban',
  note: 'Add note',
}

// The 2 dismiss buttons of a flagged chat item, and what each one saves as the
// training label of the item's messages.
export const DISMISS_LABEL_TEXT: Record<
  DismissLabel,
  { button: string; consequence: string }
> = {
  not_harmful: {
    button: 'Not harmful',
    consequence:
      'Closes the item. The guard was wrong: each flagged message is saved as not harmful.',
  },
  harmful_no_action: {
    button: 'Harmful, no action',
    consequence:
      'Closes the item with no punishment. Each flagged message is saved as harmful.',
  },
}

// What a confirmed action does, in the confirm dialog.
export const ACTION_CONSEQUENCES: Record<ActionKey, string> = {
  dismiss: 'Closes the item as no violation.',
  resolve: 'Closes the item.',
  warn: 'Sends the player this warning in game and closes the item.',
  chat_mute: 'Mutes the player in chat right away and closes the item.',
  queue_ban:
    'Keeps the player out of matchmaking right away and closes the item.',
  account_ban:
    'Bans the account right away: the player is disconnected and cannot log in.',
  void: 'Voids the match: it no longer counts, and ranked players are re-rated.',
  overturn:
    "Replaces the recorded result with the chosen player's report; ranked players are re-rated.",
  reopen: 'Opens the item again.',
  unban: 'Lifts the ban right away.',
  note: 'Adds a note to the history. The status does not change.',
}

// What a dismiss does to a contested run instead of the generic wording.
export const CONTEST_DISMISS_CONSEQUENCE =
  'Closes the contest as unfounded: the result reported before it is rated.'

export const DURATION_LABELS: Record<Duration, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  permanent: 'Permanent',
}

export const TARGET_ROLE_LABELS: Record<TargetRole, string> = {
  subject: 'Subject',
  reporter: 'Reporter',
  first_reporter: 'First reporter',
  conflicting_reporter: 'Conflicting reporter',
  contester: 'Contester',
}

export const LOBBY_KIND_LABELS: Record<LobbyKind, string> = {
  ranked: 'Ranked',
  casual: 'Casual',
  private: 'Private',
  none: 'No game',
}

export const EVENT_LABELS: Record<ItemEventKind, string> = {
  viewed: 'viewed',
  claimed: 'claimed',
  released: 'released',
  acted: 'acted',
  noted: 'noted',
  reopened: 'reopened',
}

export const REPORT_TYPE_LABELS: Record<string, string> = {
  cheating: 'Cheating',
  chat_abuse: 'Chat abuse',
  griefing: 'Griefing',
  inappropriate_username: 'Inappropriate username',
  other: 'Other',
}

const REFUSAL_TEXT: Record<RefusalCode, string> = {
  not_found: 'That item no longer exists.',
  unknown_action: 'Unknown action.',
  invalid_body: 'Something in the form is missing or invalid.',
  not_for_type: "That action doesn't apply to this item.",
  wrong_status: 'The item changed status meanwhile; reload it.',
  forbidden: 'Your role may not do that.',
  claimed: 'Someone else is handling this item.',
  invalid_target: "That player isn't part of this item.",
  no_subject: 'Pick who this applies to.',
  ban_not_found: 'That ban no longer exists.',
  unchanged: 'Nothing to change: it was already done.',
  source_missing: "The item's source record is gone.",
  nakama_failed: 'The game server did not take it; nothing was changed.',
  not_voidable: 'There is no run to void.',
}

export const refusalText = (code: RefusalCode | null, fallback: string) =>
  code ? REFUSAL_TEXT[code] : fallback

// What an action did, for the toast after it.
export function effectsText(action: ActionKey, effects: ActionEffects): string {
  const parts = [`${ACTION_LABELS[action]} done.`]
  if (effects.ban)
    parts.push(
      effects.ban.expiresAt
        ? `Ban until ${new Date(effects.ban.expiresAt).toLocaleString()}.`
        : 'Permanent ban.'
    )
  if (effects.liftedBan) parts.push('Ban lifted.')
  if (effects.voided)
    parts.push(effects.voided.rerated ? 'Players re-rated.' : 'Not rated.')
  if (effects.overturned)
    parts.push(
      effects.overturned.rerated ? 'Players re-rated.' : 'Result recorded.'
    )
  if (effects.delivered === false)
    parts.push('The game server did not get it yet.')
  return parts.join(' ')
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// "5m", "3h", "12d": how long ago, compactly.
export function ageText(iso: string, now: number): string {
  const ms = Math.max(0, now - new Date(iso).getTime())
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

export function minutesLeft(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / MINUTE))
}

export const formatTime = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '—' : new Date(value).toLocaleString()

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

export type PriorityBand = 'high' | 'medium' | 'low'

export function priorityBand(priority: number | null): PriorityBand {
  if ((priority ?? 0) >= 60) return 'high'
  if ((priority ?? 0) >= 30) return 'medium'
  return 'low'
}

// The playerId part of a 'role:playerId' actor.
export function playerIdOfActor(actor: string | null): string | null {
  if (!actor) return null
  const at = actor.indexOf(':')
  return at === -1 ? null : actor.slice(at + 1)
}

// "Alice (moderator)", or the raw actor when the name is unknown.
export function actorText(
  actor: string | null,
  names: Record<string, string>
): string {
  if (!actor) return '—'
  const role = actor.slice(0, actor.indexOf(':'))
  const name = names[actor]
  return name ? `${name} (${role})` : actor
}

export const shortId = (id: string | null | undefined) =>
  id ? id.slice(0, 8) : '—'

// Every player name the detail carries, keyed by PG id and by Nakama id
// (Nakama's run views use Nakama ids, everything else PG ids).
export function playerNamesOf(detail: ItemDetail): Map<string, string> {
  const names = new Map<string, string>()
  const add = (
    id: string | null | undefined,
    name: string | null | undefined
  ) => {
    if (id && name && !names.has(id)) names.set(id, name)
  }
  const subject = detail.subject?.player
  add(subject?.id, subject?.name)
  add(subject?.nakamaUserId, subject?.name)
  const evidence = (detail.evidence ?? {}) as {
    reporter?: { id: string; name: string | null; nakamaUserId: string | null }
    reported?: { id: string; name: string | null; nakamaUserId: string | null }
    players?: { id: string; name: string | null; nakamaUserId: string | null }[]
    chat?: { playerId: string; displayName: string }[]
    context?: { playerId: string; displayName: string }[]
    run?: { run?: { players?: { id: string; displayName: string }[] } } | null
  }
  for (const card of [
    evidence.reporter,
    evidence.reported,
    ...(evidence.players ?? []),
  ]) {
    add(card?.id, card?.name)
    add(card?.nakamaUserId, card?.name)
  }
  for (const line of [...(evidence.chat ?? []), ...(evidence.context ?? [])])
    add(line.playerId, line.displayName)
  for (const p of evidence.run?.run?.players ?? []) add(p.id, p.displayName)
  return names
}

export const nameOf = (names: Map<string, string>, id: string | null) =>
  id ? (names.get(id) ?? shortId(id)) : '—'

// Ready-made notes per action; the first matching list is offered.
export const NOTE_TEMPLATES: Partial<Record<ActionKey, string[]>> = {
  dismiss: [
    'No violation found.',
    'False positive.',
    'Duplicate of an item already handled.',
  ],
  resolve: [
    'Handled outside the queue.',
    'Accepted the recorded result.',
    'Talked to the player.',
  ],
  warn: ['First offence.', 'Borderline; warning only.'],
  chat_mute: [
    'Abusive chat.',
    'Repeated after a warning.',
    'Slurs in lobby chat.',
  ],
  queue_ban: [
    'Repeated griefing.',
    'Lied about a match result.',
    'Anti-cheat flag confirmed from the replay.',
  ],
  account_ban: ['Cheating confirmed from the replay.', 'Ban evasion.'],
  void: [
    'Run log altered; result cannot stand.',
    'Forfeit was a server-side disconnect.',
  ],
  overturn: ["Replay shows the other player's report is correct."],
  reopen: ['Reopened for a second look.', 'New evidence.'],
  unban: ['Issued in error.', 'Appeal accepted.'],
  note: ['Waiting for the replay.', 'Asked the player for details.'],
}

// Ready-made warning messages the player sees in game.
export const WARNING_TEMPLATES: string[] = [
  'Please keep lobby chat respectful. Further abuse will lead to a mute.',
  'Please report match results honestly. Repeated false reports lead to a queue ban.',
  'Leaving or stalling games ruins them for others. Further griefing will lead to a queue ban.',
  'Your run was flagged by anti-cheat. Modified clients are not allowed in matchmaking.',
]
