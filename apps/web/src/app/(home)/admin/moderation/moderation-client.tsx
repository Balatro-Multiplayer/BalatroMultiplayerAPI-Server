'use client'

import { format, formatISO } from 'date-fns'
import { Ban, ChevronRight, Plus, Search, Shield, X } from 'lucide-react'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from 'nuqs'
import { startTransition, useEffect, useOptimistic, useState } from 'react'
import { toast } from 'sonner'
import { useDebounceCallback } from 'usehooks-ts'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { hasPermission, type PermissionKey } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { api, type RouterOutputs } from '@/trpc/react'
import { ModerationPlayerCard } from './moderation-player-card'

const PAGE_SIZE = 12
const FILTER_OPTIONS = ['all', 'banned', 'striked'] as const
type MemberFilter = (typeof FILTER_OPTIONS)[number]
const FILTER_LABELS: Record<MemberFilter, string> = {
  all: 'All',
  banned: 'Banned',
  striked: 'Striked',
}

type ModerationList = RouterOutputs['moderation']['listAllMembers']
type ModerationPlayer = ModerationList['data'][number]
type ModerationStrike = ModerationPlayer['strikes'][number]
type ModerationBan = NonNullable<ModerationPlayer['active_ban']>

type OptimisticAction =
  | {
      type: 'give-strike'
      user_id: string
      strike: ModerationStrike
    }
  | {
      type: 'remove-strike'
      user_id: string
      strike_id: number
    }
  | {
      type: 'ban-user'
      user_id: string
      ban: ModerationBan
    }
  | {
      type: 'update-ban'
      user_id: string
      ban: ModerationBan
    }
  | {
      type: 'unban-user'
      user_id: string
    }

function applyOptimisticAction(
  players: ModerationPlayer[],
  action: OptimisticAction
) {
  return players.map((player) => {
    if (player.discord_id !== action.user_id) return player

    if (action.type === 'give-strike') {
      return {
        ...player,
        strikes: [action.strike, ...player.strikes],
        total_strike_points: player.total_strike_points + action.strike.amount,
        latest_strike_at: action.strike.issued_at,
      }
    }

    if (action.type === 'remove-strike') {
      const strikes = player.strikes.filter((s) => s.id !== action.strike_id)
      return {
        ...player,
        strikes,
        total_strike_points: strikes.reduce((sum, s) => sum + s.amount, 0),
        latest_strike_at: strikes[0]?.issued_at ?? null,
      }
    }

    if (action.type === 'ban-user' || action.type === 'update-ban') {
      return { ...player, active_ban: action.ban }
    }

    // unban-user
    return { ...player, active_ban: null }
  })
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

const DAY_IN_MS = 24 * 60 * 60 * 1000

function getBanLengthFromExpiry(expiresAt: string | null | undefined) {
  if (!expiresAt) return '0'

  const remainingMs = new Date(expiresAt).getTime() - Date.now()
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '1'

  return Math.max(1, Math.ceil(remainingMs / DAY_IN_MS)).toString()
}

function playerStatus(player: ModerationPlayer) {
  if (player.active_ban) return 'banned' as const
  if (player.strikes.length > 0) return 'striked' as const
  return 'normal' as const
}

function StatusBadge({ status }: { status: ReturnType<typeof playerStatus> }) {
  if (status === 'banned') {
    return (
      <Badge variant='destructive' className='gap-0.5 px-1.5 py-0 text-[11px]'>
        <Ban className='h-3 w-3' />
        Banned
      </Badge>
    )
  }
  if (status === 'striked') {
    return (
      <Badge
        variant='secondary'
        className='bg-amber-500/15 px-1.5 py-0 text-[11px] text-amber-700 dark:text-amber-400'
      >
        Striked
      </Badge>
    )
  }
  return (
    <Badge variant='secondary' className='px-1.5 py-0 text-[11px]'>
      Normal
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Desktop table row with expandable details
// ---------------------------------------------------------------------------

function ModerationTableRow({
  player,
  canManageStrikes,
  canManageBans,
  isMutating,
  expanded,
  onToggleExpand,
  onGiveStrike,
  onRemoveStrike,
  onBanUser,
  onUpdateBan,
  onLiftBan,
}: {
  player: ModerationPlayer
  canManageStrikes: boolean
  canManageBans: boolean
  isMutating: boolean
  expanded: boolean
  onToggleExpand: () => void
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
}) {
  const status = playerStatus(player)
  const [embeddedActionPanel, setEmbeddedActionPanel] = useState<
    'strike' | 'ban' | null
  >(null)

  useEffect(() => {
    if (!expanded) {
      setEmbeddedActionPanel(null)
    }
  }, [expanded])

  const openEmbeddedPanel = (panel: 'strike' | 'ban') => {
    setEmbeddedActionPanel(panel)
    if (!expanded) {
      onToggleExpand()
    }
  }

  return (
    <>
      <TableRow
        className={cn('cursor-pointer', expanded && 'bg-muted/30')}
        onClick={() => {
          if (expanded) {
            setEmbeddedActionPanel(null)
          }
          onToggleExpand()
        }}
      >
        {/* Player */}
        <TableCell>
          <div className='flex items-center gap-2.5'>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90'
              )}
            />
            <Avatar className='h-7 w-7 shrink-0'>
              <AvatarImage
                src={player.avatar_url ?? ''}
                alt={player.display_name}
              />
              <AvatarFallback className='text-[10px]'>
                {initials(player.display_name)}
              </AvatarFallback>
            </Avatar>
            <div className='min-w-0'>
              <p className='truncate font-medium text-sm'>
                {player.display_name}
              </p>
              <p className='truncate text-muted-foreground text-xs'>
                @{player.username}
              </p>
            </div>
          </div>
        </TableCell>

        {/* Status */}
        <TableCell>
          <StatusBadge status={status} />
        </TableCell>

        {/* Strikes */}
        <TableCell className='text-center tabular-nums'>
          {player.strikes.length > 0 ? (
            <span>
              {player.strikes.length}{' '}
              <span className='text-muted-foreground'>
                ({player.total_strike_points}pts)
              </span>
            </span>
          ) : (
            <span className='text-muted-foreground'>0</span>
          )}
        </TableCell>

        {/* Banned until */}
        <TableCell className='text-xs'>
          {player.active_ban ? (
            player.active_ban.expires_at ? (
              format(new Date(player.active_ban.expires_at), 'MMM d, yyyy')
            ) : (
              'Permanent'
            )
          ) : (
            <span className='text-muted-foreground'>—</span>
          )}
        </TableCell>

        {/* Actions */}
        <TableCell>
          <div className='flex items-center justify-end gap-1'>
            {canManageStrikes ? (
              <Button
                variant='ghost'
                size='sm'
                className='h-7 gap-1 px-2 text-xs'
                onClick={(e) => {
                  e.stopPropagation()
                  openEmbeddedPanel('strike')
                }}
                disabled={isMutating}
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
                onClick={(e) => {
                  e.stopPropagation()
                  openEmbeddedPanel('ban')
                }}
                disabled={isMutating}
              >
                <Ban className='h-3 w-3' />
                Ban
              </Button>
            ) : null}
            {canManageBans && player.active_ban ? (
              <Button
                variant='ghost'
                size='sm'
                className='h-7 gap-1 px-2 text-xs'
                onClick={(e) => {
                  e.stopPropagation()
                  onUpdateBan(player)
                }}
                disabled={isMutating}
              >
                Edit Ban
              </Button>
            ) : null}
            {canManageBans && player.active_ban ? (
              <Button
                variant='ghost'
                size='sm'
                className='h-7 gap-1 px-2 text-destructive text-xs hover:text-destructive'
                onClick={(e) => {
                  e.stopPropagation()
                  onLiftBan(player)
                }}
                disabled={isMutating}
              >
                Lift Ban
              </Button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded detail row */}
      {expanded ? (
        <tr>
          <td colSpan={5} className='border-b bg-muted/20 p-0'>
            <ModerationPlayerCard
              player={player}
              canManageStrikes={canManageStrikes}
              canManageBans={canManageBans}
              isMutating={isMutating}
              onGiveStrike={onGiveStrike}
              onRemoveStrike={onRemoveStrike}
              onBanUser={onBanUser}
              onUpdateBan={onUpdateBan}
              onLiftBan={onLiftBan}
              embedded
              actionPanel={embeddedActionPanel}
              onActionPanelChange={setEmbeddedActionPanel}
            />
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ModerationClient({
  permissions,
}: {
  permissions: PermissionKey[]
}) {
  const utils = api.useUtils()
  const canManageStrikes = hasPermission(
    permissions,
    'moderation.strikes.manage'
  )
  const canManageBans = hasPermission(permissions, 'moderation.bans.manage')

  // URL state
  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      search: parseAsString,
      filter: parseAsStringLiteral(FILTER_OPTIONS).withDefault('all'),
    },
    { history: 'push' }
  )
  const page = queryParams.page
  const search = queryParams.search
  const filter = queryParams.filter

  // Search
  const [searchValue, setSearchValue] = useState(search ?? '')
  const flushSearch = useDebounceCallback((value: string) => {
    setQueryParams({ search: value || null, page: 1 })
  }, 300)
  const updateSearch = (value: string) => {
    setSearchValue(value)
    flushSearch(value)
  }

  // Data
  const membersQ = api.moderation.listAllMembers.useQuery(
    {
      page,
      limit: PAGE_SIZE,
      search: search || undefined,
      filter,
      sort: filter === 'striked' ? 'recent' : 'alphabetical',
    },
    { refetchOnWindowFocus: false }
  )

  const currentPlayers = membersQ.data?.data ?? []
  const [optimisticPlayers, addOptimisticPlayer] = useOptimistic(
    currentPlayers,
    (state, action: OptimisticAction) => applyOptimisticAction(state, action)
  )
  const visiblePlayers =
    filter === 'striked'
      ? [...optimisticPlayers].sort((left, right) => {
          const leftTime = left.latest_strike_at
            ? Date.parse(left.latest_strike_at)
            : 0
          const rightTime = right.latest_strike_at
            ? Date.parse(right.latest_strike_at)
            : 0

          if (leftTime !== rightTime) {
            return rightTime - leftTime
          }

          return left.display_name.localeCompare(right.display_name)
        })
      : optimisticPlayers

  // Expanded row tracking (desktop table)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Confirmation dialogs
  const [strikeToRemove, setStrikeToRemove] = useState<{
    player: ModerationPlayer
    strike: ModerationStrike
  } | null>(null)
  const [removeStrikeReason, setRemoveStrikeReason] = useState('')
  const [banToEdit, setBanToEdit] = useState<ModerationPlayer | null>(null)
  const [editBanLength, setEditBanLength] = useState('7')
  const [editBanReason, setEditBanReason] = useState('')
  const [banToLift, setBanToLift] = useState<ModerationPlayer | null>(null)
  const [liftBanReason, setLiftBanReason] = useState('')

  // Mutations
  const giveStrike = api.moderation.giveStrike.useMutation()
  const removeStrike = api.moderation.removeStrike.useMutation()
  const banMutation = api.moderation.banUser.useMutation()
  const updateBanMutation = api.moderation.updateBanUser.useMutation()
  const unbanMutation = api.moderation.unbanUser.useMutation()

  const isMutating =
    giveStrike.isPending ||
    removeStrike.isPending ||
    banMutation.isPending ||
    updateBanMutation.isPending ||
    unbanMutation.isPending

  const applyOptimisticPlayer = (action: OptimisticAction) => {
    startTransition(() => {
      addOptimisticPlayer(action)
    })
  }

  const invalidateModeration = () => {
    startTransition(() => {
      void utils.moderation.listAllMembers.invalidate()
    })
  }

  const handleGiveStrike = async (
    player: ModerationPlayer,
    data: { amount: number; reason: string; reference?: string }
  ) => {
    const optimisticStrike: ModerationStrike = {
      id: -Date.now(),
      user_id: player.discord_id,
      reason: data.reason,
      issued_by_id: 'self',
      issued_at: formatISO(new Date()),
      expires_at: null,
      amount: data.amount,
      reference: data.reference || 'No reference provided',
      issued_by: {
        discord_id: 'self',
        username: 'you',
        display_name: 'You',
        avatar_url: null,
      },
    }
    applyOptimisticPlayer({
      type: 'give-strike',
      user_id: player.discord_id,
      strike: optimisticStrike,
    })
    try {
      await giveStrike.mutateAsync({
        user_id: player.discord_id,
        amount: data.amount,
        reason: data.reason,
        reference: data.reference,
      })
      toast.success(`Strike added to ${player.display_name}.`)
    } catch (error) {
      console.error(error)
      toast.error('Failed to add strike.')
    } finally {
      invalidateModeration()
    }
  }

  const handleBanUser = async (
    player: ModerationPlayer,
    data: { length: number; reason: string }
  ) => {
    const optimisticBan: ModerationBan = {
      id: -Date.now(),
      user_id: player.discord_id,
      reason: data.reason,
      expires_at:
        data.length === 0
          ? null
          : formatISO(new Date(Date.now() + data.length * 24 * 60 * 60 * 1000)),
      related_strike_ids: null,
      allowed_queue_ids: null,
    }
    applyOptimisticPlayer({
      type: 'ban-user',
      user_id: player.discord_id,
      ban: optimisticBan,
    })
    try {
      await banMutation.mutateAsync({
        user_id: player.discord_id,
        length: data.length,
        reason: data.reason,
      })
      toast.success(`Banned ${player.display_name}.`)
    } catch (error) {
      console.error(error)
      toast.error('Failed to ban user.')
    } finally {
      invalidateModeration()
    }
  }

  const handleRemoveStrike = async () => {
    if (!strikeToRemove) return
    const target = strikeToRemove
    applyOptimisticPlayer({
      type: 'remove-strike',
      user_id: target.player.discord_id,
      strike_id: target.strike.id,
    })
    setStrikeToRemove(null)
    setRemoveStrikeReason('')
    try {
      await removeStrike.mutateAsync({
        id: target.strike.id,
        reason: removeStrikeReason.trim() || undefined,
      })
      toast.success(`Removed strike #${target.strike.id}.`)
    } catch (error) {
      console.error(error)
      toast.error('Failed to remove strike.')
    } finally {
      invalidateModeration()
    }
  }

  const handleUpdateBan = async () => {
    if (!banToEdit) return

    const length = Number(editBanLength)
    const reason = editBanReason.trim()
    if (!Number.isFinite(length) || length < 0) {
      toast.error('Ban length must be 0 or greater.')
      return
    }
    if (!reason) {
      toast.error('Reason required.')
      return
    }

    const target = banToEdit
    const currentBan = target.active_ban
    if (!currentBan) return
    const optimisticBan: ModerationBan = {
      id: currentBan.id,
      user_id: currentBan.user_id,
      reason,
      expires_at:
        length === 0
          ? null
          : formatISO(new Date(Date.now() + length * DAY_IN_MS)),
      related_strike_ids: currentBan.related_strike_ids,
      allowed_queue_ids: currentBan.allowed_queue_ids,
    }

    applyOptimisticPlayer({
      type: 'update-ban',
      user_id: target.discord_id,
      ban: optimisticBan,
    })
    setBanToEdit(null)
    setEditBanLength('7')
    setEditBanReason('')

    try {
      await updateBanMutation.mutateAsync({
        user_id: target.discord_id,
        length,
        reason,
      })
      toast.success(`Updated ban for ${target.display_name}.`)
    } catch (error) {
      console.error(error)
      toast.error('Failed to update ban.')
    } finally {
      invalidateModeration()
    }
  }

  const handleLiftBan = async () => {
    if (!banToLift) return
    const reason = liftBanReason.trim()
    if (!reason) {
      toast.error('Reason required.')
      return
    }
    const target = banToLift
    applyOptimisticPlayer({
      type: 'unban-user',
      user_id: target.discord_id,
    })
    setBanToLift(null)
    setLiftBanReason('')
    try {
      await unbanMutation.mutateAsync({
        user_id: target.discord_id,
        reason,
      })
      toast.success(`Lifted ban for ${target.display_name}.`)
    } catch (error) {
      console.error(error)
      toast.error('Failed to lift ban.')
    } finally {
      invalidateModeration()
    }
  }

  const sharedCardProps = {
    canManageStrikes,
    canManageBans,
    isMutating,
    onGiveStrike: handleGiveStrike,
    onRemoveStrike: (
      selectedPlayer: ModerationPlayer,
      strike: ModerationStrike
    ) => {
      setStrikeToRemove({ player: selectedPlayer, strike })
      setRemoveStrikeReason('')
    },
    onBanUser: handleBanUser,
    onUpdateBan: (selectedPlayer: ModerationPlayer) => {
      setBanToEdit(selectedPlayer)
      setEditBanLength(
        getBanLengthFromExpiry(selectedPlayer.active_ban?.expires_at)
      )
      setEditBanReason(
        selectedPlayer.active_ban?.reason === 'None provided' ||
          selectedPlayer.active_ban?.reason === 'No reason provided'
          ? ''
          : (selectedPlayer.active_ban?.reason ?? '')
      )
    },
    onLiftBan: (selectedPlayer: ModerationPlayer) => {
      setBanToLift(selectedPlayer)
      setLiftBanReason('')
    },
  }

  return (
    <div className='mx-auto w-[calc(100%-1rem)] max-w-fd-container pb-8'>
      {/* Header */}
      <div className='flex items-center justify-between py-6'>
        <h1 className='font-bold text-2xl tracking-tight'>Moderation</h1>
      </div>

      {/* Toolbar: filter + search */}
      <div className='flex flex-col gap-3 pb-4 sm:flex-row sm:items-center'>
        <div className='flex rounded-lg border bg-muted/50 p-0.5'>
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              type='button'
              onClick={() => setQueryParams({ filter: f, page: 1 })}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium text-sm transition-colors',
                filter === f
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <div className='relative flex-1 sm:max-w-xs'>
          <Search className='pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={searchValue}
            placeholder='Search members...'
            onChange={(e) => updateSearch(e.target.value)}
            className='h-9 pl-8 text-sm'
          />
          {searchValue ? (
            <button
              type='button'
              className='absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground'
              onClick={() => updateSearch('')}
            >
              <X className='h-3.5 w-3.5' />
            </button>
          ) : null}
        </div>
      </div>

      {/* Loading */}
      {membersQ.isLoading ? (
        <div className='space-y-2'>
          {[1, 2, 3, 4].map((key) => (
            <div
              key={key}
              className='flex items-center gap-3 rounded-lg border p-3'
            >
              <Skeleton className='h-10 w-10 rounded-full' />
              <div className='flex-1 space-y-1.5'>
                <Skeleton className='h-4 w-32' />
                <Skeleton className='h-3 w-48' />
              </div>
            </div>
          ))}
        </div>
      ) : visiblePlayers.length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center'>
          <Shield className='h-6 w-6 text-muted-foreground' />
          <p className='text-muted-foreground text-sm'>No members found</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className='hidden rounded-lg border md:block'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='min-w-[200px]'>Player</TableHead>
                  <TableHead className='w-[100px]'>Status</TableHead>
                  <TableHead className='w-[100px] text-center'>
                    Strikes
                  </TableHead>
                  <TableHead className='w-[120px]'>Banned until</TableHead>
                  <TableHead className='w-[150px] text-right'>
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePlayers.map((player) => (
                  <ModerationTableRow
                    key={player.discord_id}
                    player={player}
                    expanded={expandedId === player.discord_id}
                    onToggleExpand={() =>
                      setExpandedId(
                        expandedId === player.discord_id
                          ? null
                          : player.discord_id
                      )
                    }
                    {...sharedCardProps}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className='space-y-2 md:hidden'>
            {visiblePlayers.map((player) => (
              <ModerationPlayerCard
                key={player.discord_id}
                player={player}
                {...sharedCardProps}
              />
            ))}
          </div>
        </>
      )}

      {membersQ.data && membersQ.data.totalPages > 1 ? (
        <div className='mt-4'>
          <PaginationControls
            currentPage={page}
            totalPages={membersQ.data.totalPages}
            total={membersQ.data.total}
            pageSize={PAGE_SIZE}
            itemLabel='members'
            onPageChange={(nextPage) => setQueryParams({ page: nextPage })}
          />
        </div>
      ) : null}

      {/* Remove Strike dialog */}
      <Dialog
        open={Boolean(strikeToRemove)}
        onOpenChange={(open) => {
          if (!open) {
            setStrikeToRemove(null)
            setRemoveStrikeReason('')
          }
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Remove Strike</DialogTitle>
            <DialogDescription>Add a removal note if needed.</DialogDescription>
          </DialogHeader>
          {strikeToRemove ? (
            <div className='rounded-lg border bg-muted/30 p-3 text-sm'>
              <p className='font-medium'>
                #{strikeToRemove.strike.id} on{' '}
                {strikeToRemove.player.display_name}
              </p>
              <p className='mt-1 text-muted-foreground'>
                {strikeToRemove.strike.reason}
              </p>
            </div>
          ) : null}
          <div className='space-y-1.5'>
            <Label className='text-xs'>Removal reason</Label>
            <Textarea
              value={removeStrikeReason}
              onChange={(e) => setRemoveStrikeReason(e.target.value)}
              rows={2}
              placeholder='Mistaken identity, duplicate, appeal accepted...'
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setStrikeToRemove(null)
                setRemoveStrikeReason('')
              }}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRemoveStrike}
              disabled={isMutating || !strikeToRemove}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Ban dialog */}
      <Dialog
        open={Boolean(banToEdit)}
        onOpenChange={(open) => {
          if (!open) {
            setBanToEdit(null)
            setEditBanLength('7')
            setEditBanReason('')
          }
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Edit Ban</DialogTitle>
            <DialogDescription>
              Update ban length in days from now. Set length to 0 for a
              permanent ban. * means required.
            </DialogDescription>
          </DialogHeader>
          {banToEdit ? (
            <div className='rounded-lg border bg-muted/30 p-3 text-sm'>
              <p className='font-medium'>{banToEdit.display_name}</p>
              <p className='mt-1 text-muted-foreground'>
                {banToEdit.active_ban?.reason ?? 'No reason provided'}
              </p>
              <p className='mt-1 text-muted-foreground text-xs'>
                Current expiry:{' '}
                {banToEdit.active_ban?.expires_at
                  ? format(
                      new Date(banToEdit.active_ban.expires_at),
                      'MMM d, yyyy HH:mm'
                    )
                  : 'Permanent'}
              </p>
            </div>
          ) : null}
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label className='text-xs'>
                Length (days from now, 0 = permanent)
              </Label>
              <Input
                type='number'
                min={0}
                value={editBanLength}
                onChange={(e) => setEditBanLength(e.target.value)}
                placeholder='7'
              />
            </div>
            <div className='space-y-1.5'>
              <Label className='text-xs'>Reason *</Label>
              <Textarea
                value={editBanReason}
                onChange={(e) => setEditBanReason(e.target.value)}
                rows={3}
                maxLength={500}
                required
                aria-required='true'
                placeholder='Repeated offenses, severe harassment...'
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setBanToEdit(null)
                setEditBanLength('7')
                setEditBanReason('')
              }}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateBan}
              disabled={
                isMutating || !banToEdit?.active_ban || !editBanReason.trim()
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lift Ban dialog */}
      <Dialog
        open={Boolean(banToLift)}
        onOpenChange={(open) => {
          if (!open) {
            setBanToLift(null)
            setLiftBanReason('')
          }
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Lift Ban</DialogTitle>
            <DialogDescription>
              Removal reason is required and sent with the unban action.
            </DialogDescription>
          </DialogHeader>
          {banToLift ? (
            <div className='rounded-lg border bg-muted/30 p-3 text-sm'>
              <p className='font-medium'>{banToLift.display_name}</p>
              <p className='mt-1 text-muted-foreground'>
                {banToLift.active_ban?.reason ?? 'No reason provided'}
              </p>
            </div>
          ) : null}
          <div className='space-y-1.5'>
            <Label className='text-xs'>Lift reason</Label>
            <Textarea
              value={liftBanReason}
              onChange={(e) => setLiftBanReason(e.target.value)}
              rows={2}
              placeholder='Appeal accepted, review complete...'
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setBanToLift(null)
                setLiftBanReason('')
              }}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleLiftBan}
              disabled={isMutating || !banToLift || !liftBanReason.trim()}
            >
              Lift Ban
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
