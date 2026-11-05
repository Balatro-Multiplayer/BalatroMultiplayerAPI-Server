'use client'

import {
  DecisionBar,
  useDecisionBar,
} from '@/components/admin/decision-bar/decision-bar'
import { PresetReasonChips } from '@/components/admin/preset-reasons/preset-reason-chips'
import { staffSend } from '@/components/admin/decision-bar/delayed-send'
import { actionTitle } from '@/components/admin/decision-bar/pick'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { StrikeSummary } from '../../players/lib/strikes'
import { STEP_LABELS } from '../../players/lib/strikes'
import {
  WARNING_MAX,
  bodyOf,
  defaultLadder,
  emptyForm,
} from '../lib/action-form'
import {
  type AppealDecisionBody,
  decideAppeal,
  queueKeys,
  refusalCodeOf,
  runAction,
} from '../lib/api'
import {
  TARGET_ROLE_LABELS,
  effectsText,
  formatTime,
  nameOf,
  refusalText,
} from '../lib/format'
import {
  APPEAL_PREFIX,
  actionOfKey,
  barActionsOf,
  deviatesFrom,
  ladderOfKey,
  recommendedPick,
} from '../lib/queue-bar'
import type {
  ContestEvidence,
  Duration,
  ItemDetail,
  MatchConflictEvidence,
} from '../lib/types'

// Whose report an overturn can make the result (a conflict's two sides), or
// who can be named the winner of a contest (its players).
function overturnSides(detail: ItemDetail): { playerId: string }[] {
  if (detail.item.itemType === 'contest')
    return ((detail.evidence as ContestEvidence | null)?.players ?? []).map(
      (p) => ({ playerId: p.id })
    )
  if (detail.item.itemType !== 'match_conflict') return []
  return (detail.evidence as MatchConflictEvidence | null)?.sides ?? []
}

function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <label className='flex items-center gap-2 text-sm'>
      <span className='text-muted-foreground'>{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value as T)}
        className='rounded-md border border-border bg-card px-2 py-1.5'
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// The service queue's decision bar: the item's actions as the server allows
// them for this role, the strike ladder's next step pre-selected, and a send
// that waits 5 s (Undo) before it reaches the server. While someone else
// holds the claim only a note can be added.
export function QueueDecisionBar({
  detail,
  names,
  heldByOther,
  onSent,
  onUndo,
  onSkip,
}: {
  detail: ItemDetail
  names: Map<string, string>
  heldByOther: boolean
  // Called when Send is pressed for an action that closes the item.
  onSent: () => void
  // Called when staff undo the waiting send: they return to this item.
  onUndo: () => void
  onSkip: () => void
}) {
  const qc = useQueryClient()
  const itemId = detail.item.id
  const itemType = detail.item.itemType
  const sides = overturnSides(detail)
  const bans = detail.subject?.bans.active ?? []
  const [targetId, setTargetId] = useState(detail.targets[0]?.playerId ?? null)
  const [toReportOf, setToReportOf] = useState(sides[0]?.playerId ?? null)
  const [banId, setBanId] = useState(bans[0]?.id ?? null)
  const [message, setMessage] = useState('')

  const all = useMemo(() => barActionsOf(detail), [detail])
  const actions = useMemo(
    () => (heldByOther ? all.filter((a) => a.key === 'note') : all),
    [all, heldByOther]
  )

  // The strikes of whoever the punishment lands on.
  const strikes = useQuery<{ strikes: StrikeSummary }>({
    queryKey: ['admin-player-strikes', targetId],
    queryFn: () => apiFetch(`/webadmin/players/${targetId}/strikes`),
    enabled: !!targetId && all.some((a) => ladderOfKey(a.key, itemType)),
  })
  const ladder = strikes.data?.strikes
  const wanted = useMemo(
    () => recommendedPick(itemType, actions, ladder),
    [itemType, actions, ladder]
  )
  const bar = useDecisionBar(actions, wanted, itemId)
  const { pick, note } = bar
  const recommended = deviatesFrom(pick, itemType, ladder)

  const picked = pick ? actionOfKey(pick.action) : null
  const allowed = picked
    ? detail.allowedActions.find((a) => a.action === picked.action)
    : undefined
  const isAppeal = pick?.action.startsWith(APPEAL_PREFIX) ?? false
  const isNote = pick?.action === 'note'

  // What would be sent, or what is missing from it.
  const check = (() => {
    if (!pick) return null
    if (isAppeal) return null
    if (!allowed || !picked) return null
    const form = {
      ...emptyForm(allowed, {
        targetPlayerId: targetId,
        toReportOf,
        banId,
        dismissLabel: picked.dismissLabel,
        ladder: defaultLadder(allowed.action, itemType),
      }),
      duration: pick.length as Duration | null,
      message,
      reason: note.trim(),
      note: isNote ? note.trim() : '',
      // The note says why the step is not the recommended one.
      deviationReason: recommended ? note.trim() : '',
    }
    return bodyOf(allowed, form, recommended)
  })()
  const missing = check && !check.ok ? check.missing : null

  const send = (text: string) => {
    if (!pick) return
    const title = actionTitle(actions, pick)
    const who =
      allowed?.targeted && targetId ? ` for ${nameOf(names, targetId)}` : ''
    const done = (message: string) => {
      toast.success(message)
      qc.invalidateQueries({ queryKey: queueKeys.all })
    }
    const failed = (err: Error) => {
      toast.error(
        err instanceof ApiError && typeof err.body.message === 'string'
          ? err.body.message
          : refusalText(refusalCodeOf(err), err.message)
      )
      qc.invalidateQueries({ queryKey: queueKeys.all })
    }
    if (isAppeal) {
      const mode = pick.action.slice(APPEAL_PREFIX.length)
      const body: AppealDecisionBody =
        mode === 'deny'
          ? { decision: 'deny', reason: text }
          : mode === 'lift'
            ? { decision: 'grant', outcome: 'lift', reason: text }
            : {
                decision: 'grant',
                outcome: 'shorten',
                duration: pick.length as '24h' | '7d' | '30d',
                reason: text,
              }
      staffSend.start({
        tag: `queue:${itemId}`,
        label: title,
        run: () => decideAppeal(itemId, body),
        onUndo,
        onDone: (r) =>
          done(
            `Appeal ${(r as { appeal: { status: string } }).appeal.status}.`
          ),
        onError: failed,
      })
      onSent()
      return
    }
    if (!check?.ok) {
      toast.error(check ? check.missing : 'Pick an action.')
      return
    }
    const { body } = check
    staffSend.start({
      tag: `queue:${itemId}`,
      label: `${title}${who}`,
      run: () => runAction(itemId, body),
      onUndo: isNote ? undefined : onUndo,
      onDone: (r) => {
        const result = r as Awaited<ReturnType<typeof runAction>>
        done(effectsText(result.action, result.effects))
      },
      onError: failed,
    })
    // A note leaves the item open; every other action closes it.
    if (!isNote) onSent()
  }

  const showTargets = allowed?.targeted && detail.targets.length > 1
  const extra = (
    <div className='space-y-2'>
      {(showTargets ||
        picked?.action === 'overturn' ||
        picked?.action === 'unban') && (
        <div className='flex flex-wrap gap-3'>
          {showTargets && (
            <Pick
              label='Applies to'
              value={targetId}
              onChange={setTargetId}
              options={detail.targets.map((t) => ({
                value: t.playerId,
                label: `${nameOf(names, t.playerId)} (${TARGET_ROLE_LABELS[t.role]})`,
              }))}
            />
          )}
          {picked?.action === 'overturn' && (
            <Pick
              label={
                itemType === 'contest'
                  ? 'Winner'
                  : 'Result stands as reported by'
              }
              value={toReportOf}
              onChange={setToReportOf}
              options={sides.map((s) => ({
                value: s.playerId,
                label: nameOf(names, s.playerId),
              }))}
            />
          )}
          {picked?.action === 'unban' && (
            <Pick
              label='Ban to lift'
              value={banId}
              onChange={setBanId}
              options={bans.map((b) => ({
                value: b.id,
                label: `${b.banType} · ${
                  b.expiresAt ? `until ${formatTime(b.expiresAt)}` : 'permanent'
                }`,
              }))}
            />
          )}
        </div>
      )}
      {picked?.action === 'warn' && (
        <div>
          <Textarea
            aria-label='Warning the player sees'
            placeholder='The warning the player sees'
            value={message}
            maxLength={WARNING_MAX}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className='text-right text-muted-foreground text-xs'>
            {message.length}/{WARNING_MAX}
          </p>
        </div>
      )}
      {recommended && (
        <p className='text-amber-400 text-sm' data-testid='ladder-deviation'>
          The ladder recommends {STEP_LABELS[recommended].toLowerCase()}. Your
          note must say why you pick another step.
        </p>
      )}
      {note.trim() && missing && (
        <p className='text-muted-foreground text-sm'>{missing}</p>
      )}
    </div>
  )

  return (
    <DecisionBar
      actions={actions}
      pick={pick}
      onChoose={bar.choose}
      onChooseLength={bar.chooseLength}
      note={note}
      onNoteChange={bar.setNote}
      onSend={send}
      sendHint={isNote ? '' : 'then open next item'}
      disabled={actions.length === 0}
      sendBlocked={missing !== null}
      disabledReason='Someone else is handling this item.'
      chips={
        <PresetReasonChips
          itemType={itemType}
          onPick={bar.setNote}
          disabled={actions.length === 0}
        />
      }
      extra={extra}
      trailing={
        <Button
          type='button'
          size='sm'
          variant='secondary'
          data-testid='skip-item'
          onClick={onSkip}
        >
          Skip
        </Button>
      }
    />
  )
}
