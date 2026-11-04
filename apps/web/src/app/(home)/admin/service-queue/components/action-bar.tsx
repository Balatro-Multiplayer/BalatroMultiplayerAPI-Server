'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  type ActionForm,
  bodyOf,
  emptyForm,
  WARNING_MAX,
} from '../lib/action-form'
import { queueKeys, refusalCodeOf, runAction } from '../lib/api'
import {
  ACTION_CONSEQUENCES,
  CONTEST_DISMISS_CONSEQUENCE,
  ACTION_LABELS,
  DURATION_LABELS,
  effectsText,
  formatTime,
  NOTE_TEMPLATES,
  nameOf,
  refusalText,
  TARGET_ROLE_LABELS,
  WARNING_TEMPLATES,
} from '../lib/format'
import type {
  AllowedAction,
  BanRow,
  ContestEvidence,
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

const liftableBans = (detail: ItemDetail): BanRow[] =>
  detail.subject?.bans.active ?? []

// unban needs a ban to lift; every other allowed action is shown as given.
const isUsable = (allowed: AllowedAction, detail: ItemDetail) =>
  allowed.action !== 'unban' || liftableBans(detail).length > 0

function Templates({
  templates,
  onPick,
}: {
  templates: string[] | undefined
  onPick: (text: string) => void
}) {
  if (!templates?.length) return null
  return (
    <div className='flex flex-wrap gap-1'>
      {templates.map((t) => (
        <Button
          key={t}
          type='button'
          size='sm'
          variant='secondary'
          className='h-auto whitespace-normal py-1 text-left text-xs'
          onClick={() => onPick(t)}
        >
          {t}
        </Button>
      ))}
    </div>
  )
}

function ActionDialog({
  detail,
  allowed,
  names,
  onClose,
}: {
  detail: ItemDetail
  allowed: AllowedAction
  names: Map<string, string>
  onClose: () => void
}) {
  const qc = useQueryClient()
  const sides = overturnSides(detail)
  const bans = liftableBans(detail)
  const [form, setForm] = useState<ActionForm>(() =>
    emptyForm(allowed, {
      targetPlayerId: detail.targets[0]?.playerId ?? null,
      toReportOf: sides[0]?.playerId ?? null,
      banId: bans[0]?.id ?? null,
    })
  )
  const set = (patch: Partial<ActionForm>) =>
    setForm((f) => ({ ...f, ...patch }))
  const check = bodyOf(allowed, form)

  const mutation = useMutation({
    mutationFn: () => {
      if (!check.ok) throw new Error(check.missing)
      return runAction(detail.item.id, check.body)
    },
    onSuccess: (result) => {
      toast.success(effectsText(result.action, result.effects))
      qc.invalidateQueries({ queryKey: queueKeys.all })
      onClose()
    },
    onError: (err: Error) =>
      toast.error(refusalText(refusalCodeOf(err), err.message)),
  })

  const label = ACTION_LABELS[allowed.action]
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid={`action-dialog-${allowed.action}`}>
        <DialogHeader>
          <DialogTitle>
            {allowed.destructive ? `${label}: are you sure?` : label}
          </DialogTitle>
          <DialogDescription>
            {detail.item.itemType === 'contest' && allowed.action === 'dismiss'
              ? CONTEST_DISMISS_CONSEQUENCE
              : ACTION_CONSEQUENCES[allowed.action]}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          {allowed.targeted && detail.targets.length > 0 && (
            <div className='space-y-1'>
              <Label>Applies to</Label>
              <Select
                value={form.targetPlayerId ?? undefined}
                onValueChange={(v) => set({ targetPlayerId: v })}
              >
                <SelectTrigger className='w-full' data-testid='target-select'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {detail.targets.map((t) => (
                    <SelectItem key={t.playerId} value={t.playerId}>
                      {nameOf(names, t.playerId)} ({TARGET_ROLE_LABELS[t.role]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {allowed.presets && (
            <div className='space-y-1'>
              <Label>Duration</Label>
              <div className='flex flex-wrap gap-1'>
                {allowed.presets.map((p) => (
                  <Button
                    key={p}
                    type='button'
                    size='sm'
                    variant={form.duration === p ? 'default' : 'outline'}
                    onClick={() => set({ duration: p })}
                  >
                    {DURATION_LABELS[p]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {allowed.action === 'warn' && (
            <div className='space-y-1'>
              <Label htmlFor='sq-warning'>Warning the player sees</Label>
              <Textarea
                id='sq-warning'
                value={form.message}
                maxLength={WARNING_MAX}
                onChange={(e) => set({ message: e.target.value })}
              />
              <div className='text-right text-muted-foreground text-xs'>
                {form.message.length}/{WARNING_MAX}
              </div>
              <Templates
                templates={WARNING_TEMPLATES}
                onPick={(t) => set({ message: t })}
              />
            </div>
          )}

          {allowed.action === 'overturn' && (
            <div className='space-y-1'>
              <Label>
                {detail.item.itemType === 'contest'
                  ? 'Winner'
                  : 'Result stands as reported by'}
              </Label>
              <Select
                value={form.toReportOf ?? undefined}
                onValueChange={(v) => set({ toReportOf: v })}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sides.map((s) => (
                    <SelectItem key={s.playerId} value={s.playerId}>
                      {nameOf(names, s.playerId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {allowed.action === 'unban' && (
            <div className='space-y-1'>
              <Label>Ban to lift</Label>
              <Select
                value={form.banId ?? undefined}
                onValueChange={(v) => set({ banId: v })}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bans.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.banType} ·{' '}
                      {b.expiresAt
                        ? `until ${formatTime(b.expiresAt)}`
                        : 'permanent'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {allowed.action !== 'note' && (
            <div className='space-y-1'>
              <Label htmlFor='sq-reason'>
                Reason (required, kept in the staff log)
              </Label>
              <Input
                id='sq-reason'
                value={form.reason}
                onChange={(e) => set({ reason: e.target.value })}
              />
            </div>
          )}

          <div className='space-y-1'>
            <Label htmlFor='sq-note'>
              {allowed.action === 'note'
                ? 'Note'
                : 'Note (staff only, optional)'}
            </Label>
            <Textarea
              id='sq-note'
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
            />
            <Templates
              templates={NOTE_TEMPLATES[allowed.action]}
              onPick={(t) => set({ note: t })}
            />
          </div>
        </div>

        <DialogFooter>
          {!check.ok && (
            <p className='mr-auto text-muted-foreground text-sm'>
              {check.missing}
            </p>
          )}
          <Button
            variant='outline'
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            data-testid='action-confirm'
            variant={allowed.destructive ? 'destructive' : 'default'}
            disabled={!check.ok || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Working…' : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The item's actions, exactly as the server allows them for this role and
// status; while someone else holds the claim only a note can be added.
export function ActionBar({
  detail,
  names,
  heldByOther,
}: {
  detail: ItemDetail
  names: Map<string, string>
  heldByOther: boolean
}) {
  const [open, setOpen] = useState<AllowedAction | null>(null)
  const actions = detail.allowedActions.filter((a) => isUsable(a, detail))
  return (
    <div
      className='sticky bottom-0 z-10 flex flex-wrap gap-2 border-border border-t bg-background/95 p-3 backdrop-blur'
      data-testid='action-bar'
    >
      {actions.map((a) => (
        <Button
          key={a.action}
          size='sm'
          data-action={a.action}
          variant={
            a.destructive
              ? 'destructive'
              : a.action === 'note'
                ? 'ghost'
                : 'outline'
          }
          disabled={heldByOther && a.action !== 'note'}
          onClick={() => setOpen(a)}
        >
          {ACTION_LABELS[a.action]}
        </Button>
      ))}
      {open && (
        <ActionDialog
          key={`${detail.item.id}-${open.action}`}
          detail={detail}
          allowed={open}
          names={names}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
