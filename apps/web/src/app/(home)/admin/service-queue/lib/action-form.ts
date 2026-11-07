// The action dialog's form and the request body it turns into. Pure: the
// dialog holds an ActionForm, and bodyOf says what to send or what's missing.
import type { Ladder, LadderStep } from '../../players/lib/strikes'
import type { ActionBody, AllowedAction, DismissLabel, Duration } from './types'

export const WARNING_MAX = 500

export interface ActionForm {
  targetPlayerId: string | null
  duration: Duration | null
  message: string
  reason: string
  toReportOf: string | null
  banId: string | null
  note: string
  // Which dismiss button a flagged chat item was opened with.
  dismissLabel: DismissLabel | null
  // The strike ladder this punishment counts on, and why it is not the recommended step.
  ladder: Ladder
  deviationReason: string
}

// The ladder a queue punishment counts on unless staff pick another.
export function defaultLadder(action: string, itemType: string): Ladder {
  if (action === 'chat_mute') return 'chat'
  if (action === 'queue_ban') return 'play'
  return itemType === 'flagged_chat' ? 'chat' : 'play'
}

export function emptyForm(
  allowed: AllowedAction,
  defaults: {
    targetPlayerId: string | null
    toReportOf: string | null
    banId: string | null
    dismissLabel?: DismissLabel | null
    ladder?: Ladder
  }
): ActionForm {
  return {
    targetPlayerId: defaults.targetPlayerId,
    duration: allowed.presets?.[0] ?? null,
    message: '',
    reason: '',
    toReportOf: defaults.toReportOf,
    banId: defaults.banId,
    note: '',
    dismissLabel: defaults.dismissLabel ?? null,
    ladder: defaults.ladder ?? 'play',
    deviationReason: '',
  }
}

export type BodyCheck =
  | { ok: true; body: ActionBody }
  | { ok: false; missing: string }

const optional = (text: string) => (text.trim() ? text.trim() : undefined)

// The step a form applies: a warning, or the ban length picked.
export function appliedStepOf(allowed: AllowedAction, form: ActionForm): LadderStep | null {
  if (allowed.action === 'warn') return 'warning'
  if (allowed.action === 'chat_mute' || allowed.action === 'queue_ban') return form.duration
  return null
}

// recommended: the step the ladder recommends, once it is known. A different
// step needs the reason why.
export function bodyOf(
  allowed: AllowedAction,
  form: ActionForm,
  recommended: LadderStep | null = null
): BodyCheck {
  const note = optional(form.note)
  const target = form.targetPlayerId ?? undefined
  if (allowed.action === 'note') {
    if (!note) return { ok: false, missing: 'Write the note.' }
    return { ok: true, body: { action: 'note', note } }
  }
  const reason = form.reason.trim()
  if (!reason) return { ok: false, missing: 'Write the reason.' }
  const applied = appliedStepOf(allowed, form)
  const deviation = optional(form.deviationReason)
  if (applied && recommended && applied !== recommended && !deviation)
    return {
      ok: false,
      missing: `The ladder recommends ${recommended}. Say why you pick ${applied}.`,
    }
  const strike = applied ? { ladder: form.ladder, deviationReason: deviation } : {}
  switch (allowed.action) {
    case 'dismiss':
      return {
        ok: true,
        body: {
          action: 'dismiss',
          reason,
          note,
          ...(form.dismissLabel ? { dismissLabel: form.dismissLabel } : {}),
        },
      }
    case 'resolve':
    case 'void':
    case 'reopen':
      return { ok: true, body: { action: allowed.action, reason, note } }
    case 'warn': {
      const message = form.message.trim()
      if (!message)
        return { ok: false, missing: 'Write the warning the player will see.' }
      if (message.length > WARNING_MAX)
        return {
          ok: false,
          missing: `The warning is over ${WARNING_MAX} characters.`,
        }
      return {
        ok: true,
        body: { action: 'warn', reason, message, targetPlayerId: target, note, ...strike },
      }
    }
    case 'chat_mute':
    case 'queue_ban':
    case 'account_ban':
      if (!form.duration) return { ok: false, missing: 'Pick a duration.' }
      return {
        ok: true,
        body: {
          action: allowed.action,
          duration: form.duration,
          reason,
          targetPlayerId: target,
          note,
          ...(allowed.action === 'account_ban' ? {} : strike),
        },
      }
    case 'overturn':
      if (!form.toReportOf)
        return { ok: false, missing: 'Pick whose report stands.' }
      return {
        ok: true,
        body: { action: 'overturn', reason, toReportOf: form.toReportOf, note },
      }
    case 'unban':
      if (!form.banId) return { ok: false, missing: 'Pick the ban to lift.' }
      return {
        ok: true,
        body: { action: 'unban', reason, banId: form.banId, note },
      }
  }
}
