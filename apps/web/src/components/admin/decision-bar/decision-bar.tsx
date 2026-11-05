'use client'

import { cn } from '@/lib/utils'
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { type DelayedSend, staffSend } from './delayed-send'
import {
  type BarAction,
  type BarPick,
  actionTitle,
  canSend,
  cleanNote,
  openingPick,
  pickAction,
} from './pick'

// The state a bar needs: the pick and the note. A page that has more fields
// next to the bar keeps this itself; a plain page uses this hook as is. Give
// the hook a new `resetKey` (for example the open item) to clear the note and
// go back to the wanted pick.
export function useDecisionBar(
  actions: readonly BarAction[],
  wanted: BarPick | null,
  resetKey: string | number,
) {
  const [pick, setPick] = useState<BarPick | null>(() =>
    openingPick(actions, wanted),
  )
  const [note, setNote] = useState('')
  const wantedKey = `${wanted?.action}:${wanted?.length}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new key or wish resets the bar, not each render's new actions array
  useEffect(() => {
    setPick(openingPick(actions, wanted))
    setNote('')
  }, [resetKey])
  // A wish that arrives late (the ladder loads after the item) changes the
  // pick but keeps the note.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    setPick(openingPick(actions, wanted))
  }, [wantedKey])
  return {
    pick,
    note,
    setNote,
    choose: (key: string) => setPick((p) => pickAction(actions, p, key)),
    chooseLength: (length: string) =>
      setPick((p) => (p ? { ...p, length } : p)),
  }
}

// The bar for every staff action: action buttons (a length where the action
// has one), a required note, and a Send button that names the action. Send
// does not send: the page's onSend starts a delayed send (see delayed-send.ts)
// and the Undo strip shows until it runs.
export function DecisionBar({
  actions,
  pick,
  onChoose,
  onChooseLength,
  note,
  onNoteChange,
  onSend,
  sendHint = 'then open next item',
  disabled = false,
  sendBlocked = false,
  disabledReason,
  chips,
  extra,
  trailing,
  notePlaceholder = 'Why? Goes in the staff log.',
}: {
  actions: readonly BarAction[]
  pick: BarPick | null
  onChoose: (key: string) => void
  onChooseLength: (length: string) => void
  note: string
  onNoteChange: (note: string) => void
  // Called with the cleaned note when staff press Send.
  onSend: (note: string) => void
  // Small text under the Send title; empty for a page that stays put.
  sendHint?: string
  disabled?: boolean
  // Keeps Send off while the note field stays usable (a field the action needs is empty).
  sendBlocked?: boolean
  // Shown in place of the note field while the bar is disabled.
  disabledReason?: string
  // Slot between the buttons and the note for preset reason chips.
  chips?: ReactNode
  // Slot for fields the picked action needs (a target, a warning text).
  extra?: ReactNode
  // Slot at the end of the button row, for example Skip.
  trailing?: ReactNode
  notePlaceholder?: string
}) {
  const ready = canSend(actions, pick, note, disabled || sendBlocked)
  const picked = actions.find((a) => a.key === pick?.action)
  const title = (pick && actionTitle(actions, pick)) || 'Pick an action'
  const send = () => {
    if (ready) onSend(cleanNote(note))
  }
  return (
    <div
      className='shrink-0 space-y-2 border-border border-t bg-background/95 p-3 backdrop-blur'
      data-testid='decision-bar'
    >
      <div className='flex flex-wrap items-center gap-2'>
        {actions.map((a) => {
          const on = a.key === pick?.action
          return (
            <span key={a.key} className='inline-flex items-center gap-1'>
              <button
                type='button'
                data-action={a.key}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChoose(a.key)}
                className={cn(
                  'rounded-md border px-3 py-2 font-semibold text-sm disabled:opacity-50',
                  on
                    ? a.destructive
                      ? 'border-destructive bg-destructive text-white'
                      : 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                {a.label}
                {a.hint && (
                  <span className='ml-1 font-normal text-xs opacity-80'>
                    {a.hint}
                  </span>
                )}
              </button>
              {on && a.lengths && (
                <select
                  aria-label='Length'
                  data-testid='length-select'
                  value={pick?.length ?? ''}
                  disabled={disabled}
                  onChange={(e) => onChooseLength(e.target.value)}
                  className='rounded-md border border-border bg-card px-2 py-2 text-sm'
                >
                  {a.lengths.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
            </span>
          )
        })}
        {trailing && <span className='ml-auto'>{trailing}</span>}
      </div>
      {chips}
      {extra}
      <form
        className='flex flex-col items-stretch gap-2 sm:flex-row'
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          disabled={disabled}
          placeholder={
            disabled && disabledReason ? disabledReason : notePlaceholder
          }
          aria-label='Note (needed)'
          data-testid='decision-note'
          className='min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm'
        />
        <button
          type='submit'
          data-testid='decision-send'
          disabled={!ready}
          className={cn(
            'rounded-md px-4 py-2 text-center sm:min-w-40 sm:py-1 font-semibold text-sm leading-tight disabled:opacity-50',
            picked?.destructive
              ? 'bg-destructive text-white'
              : 'bg-primary text-primary-foreground',
          )}
        >
          <span className='block'>{title}</span>
          {pick && sendHint && (
            <span className='block font-normal text-xs opacity-80'>
              {sendHint}
            </span>
          )}
        </button>
      </form>
    </div>
  )
}

// The strip that shows while a send waits: what will be sent, a countdown and
// Undo. It reads the shared sender, so any page can mount it.
export function UndoStrip({
  sender = staffSend,
  className,
}: {
  sender?: DelayedSend
  className?: string
}) {
  const pending = useSyncExternalStore(
    sender.subscribe,
    sender.getSnapshot,
    () => null,
  )
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!pending) return
    const tick = () =>
      setLeft(Math.max(0, pending.startedAt + pending.delayMs - Date.now()))
    tick()
    const t = setInterval(tick, 100)
    return () => clearInterval(t)
  }, [pending])
  if (!pending) return null
  const share = Math.min(1, left / pending.delayMs)
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-border border-b bg-sky-950/60 px-4 py-3 text-sm',
        className,
      )}
      data-testid='undo-strip'
      role='status'
    >
      <span>
        <strong>{pending.label}</strong> sends in {Math.ceil(left / 1000)} s.
      </span>
      <span className='h-1 min-w-12 flex-1 overflow-hidden rounded bg-white/10'>
        <span
          className='block h-full bg-sky-500'
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <button
        type='button'
        data-testid='undo-send'
        onClick={() => sender.undo()}
        className='rounded-md border border-sky-500 px-3 py-1 font-semibold text-sky-400 hover:bg-sky-500/10'
      >
        Undo
      </button>
    </div>
  )
}
