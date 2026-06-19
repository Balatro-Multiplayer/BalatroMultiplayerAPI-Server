'use client'

import { format, formatDistanceToNowStrict } from 'date-fns'
import { Ban, ChevronRight, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import type { RouterOutputs } from '@/trpc/react'

type ModerationPlayer =
  RouterOutputs['moderation']['listAllMembers']['data'][number]
type ModerationStrike = ModerationPlayer['strikes'][number]
type ActionPanel = 'strike' | 'ban' | null

const STRIKE_LABELS: Record<number, string> = {
  0: 'Warning',
  1: 'No punishment',
  2: '1d QTO',
  3: '3d QTO',
  4: '7d QTO + ban',
  5: 'Month QTO + ban',
  6: 'Perma blacklist',
}

const STRIKE_OPTIONS = [
  { value: '0', label: '0 · Warning' },
  { value: '1', label: '1 · No punishment' },
  { value: '2', label: '2 · 1d QTO' },
  { value: '3', label: '3 · 3d QTO' },
  { value: '4', label: '4 · 7d QTO + ban' },
  { value: '5', label: '5 · Month QTO + ban' },
  { value: '6', label: '6 · Perma blacklist' },
] as const

const CUSTOM_STRIKE_REASON = '__custom__' as const

const PREDEFINED_STRIKE_REASONS = [
  'Failure to vote',
  'AFK in queue',
  'AFK during a game',
  'Harassment',
  'Offensive language',
  'R-slur',
  'Self r-slur',
] as const

const CUSTOM_BAN_REASON = '__custom__' as const

const PREDEFINED_BAN_REASONS = [
  'Repeated offenses',
  'Severe harassment',
  'Cheating in ranked across multiple games',
] as const

type StrikeReasonPreset =
  | (typeof PREDEFINED_STRIKE_REASONS)[number]
  | typeof CUSTOM_STRIKE_REASON

type BanReasonPreset =
  | (typeof PREDEFINED_BAN_REASONS)[number]
  | typeof CUSTOM_BAN_REASON

function relativeTime(value: string | null) {
  if (!value) return 'never'
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true })
}

function formatDateTime(value: string) {
  return format(new Date(value), 'MMM d, yyyy HH:mm')
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function ModerationPlayerCard({
  player,
  canManageStrikes,
  canManageBans,
  isMutating,
  onGiveStrike,
  onRemoveStrike,
  onBanUser,
  onUpdateBan,
  onLiftBan,
  embedded = false,
  actionPanel,
  onActionPanelChange,
}: {
  player: ModerationPlayer
  canManageStrikes: boolean
  canManageBans: boolean
  isMutating: boolean
  onGiveStrike: (
    player: ModerationPlayer,
    data: { amount: number; reason: string; reference?: string }
  ) => void
  onRemoveStrike: (player: ModerationPlayer, strike: ModerationStrike) => void
  onBanUser: (
    player: ModerationPlayer,
    data: { length: number; reason: string }
  ) => void
  onUpdateBan: (player: ModerationPlayer) => void
  onLiftBan: (player: ModerationPlayer) => void
  embedded?: boolean
  actionPanel?: ActionPanel
  onActionPanelChange?: (panel: ActionPanel) => void
}) {
  const [expanded, setExpanded] = useState(embedded)
  const [internalActionPanel, setInternalActionPanel] =
    useState<ActionPanel>(null)
  const strikeCount = player.strikes.length
  const activeActionPanel = actionPanel ?? internalActionPanel

  // Strike form
  const [strikeAmount, setStrikeAmount] =
    useState<(typeof STRIKE_OPTIONS)[number]['value']>('1')
  const [strikeReasonPreset, setStrikeReasonPreset] =
    useState<StrikeReasonPreset>(CUSTOM_STRIKE_REASON)
  const [customStrikeReason, setCustomStrikeReason] = useState('')
  const [strikeReference, setStrikeReference] = useState('')

  // Ban form
  const [banLength, setBanLength] = useState('7')
  const [banReasonPreset, setBanReasonPreset] =
    useState<BanReasonPreset>(CUSTOM_BAN_REASON)
  const [customBanReason, setCustomBanReason] = useState('')
  const customStrikeReasonValue = customStrikeReason.trim()
  const strikeReasonValue =
    strikeReasonPreset === CUSTOM_STRIKE_REASON
      ? customStrikeReasonValue
      : strikeReasonPreset
  const banReasonValue =
    banReasonPreset === CUSTOM_BAN_REASON
      ? customBanReason.trim()
      : banReasonPreset

  const resetForms = () => {
    setStrikeAmount('1')
    setStrikeReasonPreset(CUSTOM_STRIKE_REASON)
    setCustomStrikeReason('')
    setStrikeReference('')
    setBanLength('7')
    setBanReasonPreset(CUSTOM_BAN_REASON)
    setCustomBanReason('')
  }

  const setActionPanel = (panel: ActionPanel) => {
    setInternalActionPanel(panel)
    onActionPanelChange?.(panel)
  }

  const handleSubmitStrike = () => {
    if (!strikeReasonValue) return

    onGiveStrike(player, {
      amount: Number(strikeAmount),
      reason: strikeReasonValue,
      reference: strikeReference.trim() || undefined,
    })
    setActionPanel(null)
    resetForms()
  }

  const handleSubmitBan = () => {
    const length = Number(banLength)
    if (!Number.isFinite(length) || length < 0 || !banReasonValue) return

    onBanUser(player, {
      length,
      reason: banReasonValue,
    })
    setActionPanel(null)
    resetForms()
  }

  return (
    <div
      className={cn(!embedded && 'rounded-lg border bg-card transition-colors')}
    >
      {/* Summary row — hidden when embedded in table */}
      {!embedded ? (
        <div className='flex w-full items-center gap-3 p-3'>
          <button
            type='button'
            onClick={() => setExpanded(!expanded)}
            className='flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80'
          >
            <Avatar className='h-9 w-9 shrink-0'>
              <AvatarImage
                src={player.avatar_url ?? ''}
                alt={player.display_name}
              />
              <AvatarFallback className='text-xs'>
                {initials(player.display_name)}
              </AvatarFallback>
            </Avatar>

            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <span className='truncate font-medium text-sm'>
                  {player.display_name}
                </span>
                {player.active_ban ? (
                  <Badge
                    variant='destructive'
                    className='shrink-0 gap-0.5 px-1.5 py-0 text-[11px]'
                  >
                    <Ban className='h-3 w-3' />
                    banned
                  </Badge>
                ) : null}
                {strikeCount > 0 ? (
                  <Badge
                    variant='secondary'
                    className='shrink-0 px-1.5 py-0 text-[11px]'
                  >
                    {player.total_strike_points}pts · {strikeCount}{' '}
                    {strikeCount === 1 ? 'strike' : 'strikes'}
                  </Badge>
                ) : null}
              </div>
              <p className='truncate text-muted-foreground text-xs'>
                @{player.username}
                {strikeCount > 0
                  ? ` · last ${relativeTime(player.latest_strike_at)}`
                  : ''}
              </p>
            </div>

            <ChevronRight
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90'
              )}
            />
          </button>

          {/* Action buttons — outside the expand button */}
          <div className='flex shrink-0 items-center gap-1'>
            {canManageStrikes ? (
              <Button
                variant='ghost'
                size='sm'
                className='h-7 gap-1 px-2 text-xs'
                onClick={() => {
                  setExpanded(true)
                  setActionPanel(
                    activeActionPanel === 'strike' ? null : 'strike'
                  )
                }}
              >
                <Plus className='h-3 w-3' />
                Strike
              </Button>
            ) : null}
            {canManageBans && !player.active_ban ? (
              <Button
                variant='ghost'
                size='sm'
                className='h-7 gap-1 px-2 text-xs'
                onClick={() => {
                  setExpanded(true)
                  setActionPanel(activeActionPanel === 'ban' ? null : 'ban')
                }}
              >
                <Ban className='h-3 w-3' />
                Ban
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Expanded details */}
      {expanded ? (
        <div className={cn(!embedded && 'border-t', 'space-y-3 px-3 py-3')}>
          {/* Inline strike form */}
          {activeActionPanel === 'strike' ? (
            <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
              <div className='flex items-center justify-between'>
                <h3 className='font-semibold text-xs'>
                  Give Strike to {player.display_name}
                </h3>
                <button
                  type='button'
                  onClick={() => {
                    setActionPanel(null)
                    resetForms()
                  }}
                  className='rounded p-0.5 text-muted-foreground hover:text-foreground'
                >
                  <span className='sr-only'>Close</span>
                  &times;
                </button>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label className='text-xs'>Amount</Label>
                  <Select
                    value={strikeAmount}
                    onValueChange={(v) =>
                      setStrikeAmount(v as typeof strikeAmount)
                    }
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STRIKE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs'>Reference</Label>
                  <Input
                    value={strikeReference}
                    onChange={(e) => setStrikeReference(e.target.value)}
                    placeholder='Queue ID, thread, ticket...'
                  />
                </div>
                <div className='space-y-1 sm:col-span-2'>
                  <Label className='text-xs'>Preset reason</Label>
                  <Select
                    value={strikeReasonPreset}
                    onValueChange={(value) =>
                      setStrikeReasonPreset(value as StrikeReasonPreset)
                    }
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CUSTOM_STRIKE_REASON}>
                        Custom only
                      </SelectItem>
                      {PREDEFINED_STRIKE_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1 sm:col-span-2'>
                  <Label className='text-xs'>Reason *</Label>
                  {strikeReasonPreset === CUSTOM_STRIKE_REASON ? (
                    <>
                      <Textarea
                        value={customStrikeReason}
                        onChange={(e) => setCustomStrikeReason(e.target.value)}
                        rows={2}
                        maxLength={500}
                        required
                        aria-required='true'
                        placeholder='AFK in queue, abusive DM...'
                      />
                      <p className='text-muted-foreground text-xs'>
                        Enter a custom reason or pick a preset above.
                      </p>
                    </>
                  ) : (
                    <Input value={strikeReasonPreset} readOnly />
                  )}
                </div>
              </div>
              <div className='flex justify-end gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => {
                    setActionPanel(null)
                    resetForms()
                  }}
                  disabled={isMutating}
                >
                  Cancel
                </Button>
                <Button
                  size='sm'
                  onClick={handleSubmitStrike}
                  disabled={isMutating || !strikeReasonValue}
                >
                  Confirm Strike
                </Button>
              </div>
            </div>
          ) : null}

          {/* Inline ban form */}
          {activeActionPanel === 'ban' ? (
            <div className='space-y-3 rounded-md border bg-muted/30 p-3'>
              <div className='flex items-center justify-between'>
                <h3 className='font-semibold text-xs'>
                  Ban {player.display_name}
                </h3>
                <button
                  type='button'
                  onClick={() => {
                    setActionPanel(null)
                    resetForms()
                  }}
                  className='rounded p-0.5 text-muted-foreground hover:text-foreground'
                >
                  <span className='sr-only'>Close</span>
                  &times;
                </button>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label className='text-xs'>
                    Length (days, 0 = permanent)
                  </Label>
                  <Input
                    type='number'
                    min={0}
                    value={banLength}
                    onChange={(e) => setBanLength(e.target.value)}
                    placeholder='7'
                  />
                  <p className='text-muted-foreground text-xs'>
                    Set to 0 for a permanent ban.
                  </p>
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs'>Reason preset</Label>
                  <Select
                    value={banReasonPreset}
                    onValueChange={(value) =>
                      setBanReasonPreset(value as BanReasonPreset)
                    }
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CUSTOM_BAN_REASON}>
                        Custom only
                      </SelectItem>
                      {PREDEFINED_BAN_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs'>Reason *</Label>
                  {banReasonPreset === CUSTOM_BAN_REASON ? (
                    <>
                      <Textarea
                        value={customBanReason}
                        onChange={(e) => setCustomBanReason(e.target.value)}
                        rows={2}
                        maxLength={500}
                        required
                        aria-required='true'
                        placeholder='Repeated offenses, severe harassment...'
                      />
                      <p className='text-muted-foreground text-xs'>
                        Enter a custom reason or pick a preset above.
                      </p>
                    </>
                  ) : (
                    <Input value={banReasonPreset} readOnly />
                  )}
                </div>
              </div>
              <div className='flex justify-end gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => {
                    setActionPanel(null)
                    resetForms()
                  }}
                  disabled={isMutating}
                >
                  Cancel
                </Button>
                <Button
                  size='sm'
                  onClick={handleSubmitBan}
                  disabled={isMutating || !banReasonValue}
                >
                  Confirm Ban
                </Button>
              </div>
            </div>
          ) : null}

          {/* Ban info */}
          {player.active_ban ? (
            <div className='flex items-start justify-between gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2.5'>
              <div className='min-w-0 space-y-0.5'>
                <div className='flex items-center gap-1.5 font-medium text-xs'>
                  <ShieldAlert className='h-3.5 w-3.5 text-destructive' />
                  Ban active
                </div>
                <p className='text-xs'>{player.active_ban.reason}</p>
                <p className='text-muted-foreground text-xs'>
                  {player.active_ban.expires_at
                    ? `Expires ${format(new Date(player.active_ban.expires_at), 'MMM d, yyyy HH:mm')}`
                    : 'Permanent'}
                </p>
              </div>
              {canManageBans ? (
                <div className='flex shrink-0 gap-1'>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-7 text-xs'
                    onClick={() => onUpdateBan(player)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant='destructive'
                    size='sm'
                    className='h-7 text-xs'
                    onClick={() => onLiftBan(player)}
                  >
                    Lift
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Strikes */}
          {player.strikes.length === 0 ? (
            <p className='py-4 text-center text-muted-foreground text-xs'>
              No strike history
            </p>
          ) : (
            <div className='space-y-1.5'>
              {player.strikes.map((strike) => (
                <div
                  key={strike.id}
                  className='flex items-start gap-2 rounded-md border bg-background p-2.5'
                >
                  <Badge
                    className={cn(
                      'mt-0.5 shrink-0 px-1.5 py-0 text-[11px]',
                      strike.amount >= 4
                        ? 'bg-destructive text-white'
                        : strike.amount >= 2
                          ? 'bg-amber-500 text-black'
                          : 'bg-muted text-foreground'
                    )}
                  >
                    {STRIKE_LABELS[strike.amount] ?? `${strike.amount}pts`}
                  </Badge>

                  <div className='min-w-0 flex-1 space-y-0.5'>
                    <p className='text-xs'>{strike.reason}</p>
                    <p className='text-[11px] text-muted-foreground'>
                      Issued {formatDateTime(strike.issued_at)}
                      {' · '}
                      {strike.expires_at
                        ? `Expires ${formatDateTime(strike.expires_at)}`
                        : 'No expiry'}
                      {strike.reference ? ` · ${strike.reference}` : ''}
                      {' · '}
                      {strike.issued_by?.username ?? strike.issued_by_id}
                    </p>
                  </div>

                  {canManageStrikes ? (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive'
                      onClick={() => onRemoveStrike(player, strike)}
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
