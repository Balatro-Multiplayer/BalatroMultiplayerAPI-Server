'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useState } from 'react'
import { toast } from 'sonner'
import { DiscordEmoji } from '@/components/discord-emoji'
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
import { Switch } from '@/components/ui/switch'
import type { QueueSettings } from '@/server/services/botlatro.service'
import { api } from '@/trpc/react'

type EditableFields = Partial<Omit<QueueSettings, 'id' | 'queue_name'>>

type FieldDef = {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'color'
  nullable?: boolean
}

const FIELD_CONFIG: FieldDef[] = [
  { key: 'queue_desc', label: 'Description', type: 'text' },
  { key: 'queue_icon', label: 'Icon', type: 'text', nullable: true },
  { key: 'color', label: 'Color', type: 'color' },
  { key: 'default_elo', label: 'Default ELO', type: 'number' },
  { key: 'members_per_team', label: 'Members per Team', type: 'number' },
  { key: 'number_of_teams', label: 'Number of Teams', type: 'number' },
  { key: 'elo_search_start', label: 'ELO Search Start', type: 'number' },
  {
    key: 'elo_search_increment',
    label: 'ELO Search Increment',
    type: 'number',
  },
  {
    key: 'elo_search_speed',
    label: 'ELO Search Speed (s)',
    type: 'number',
  },
  {
    key: 'max_party_elo_difference',
    label: 'Max Party ELO Diff',
    type: 'number',
    nullable: true,
  },
  { key: 'best_of_allowed', label: 'Best-of Allowed', type: 'boolean' },
  { key: 'first_deck_ban_num', label: 'Deck Bans', type: 'number' },
  { key: 'second_deck_ban_num', label: 'Deck Picks', type: 'number' },
  { key: 'use_tuple_bans', label: 'Tuple Bans', type: 'boolean' },
  {
    key: 'veto_mmr_threshold',
    label: 'Veto MMR Threshold',
    type: 'number',
    nullable: true,
  },
  { key: 'instaqueue_min', label: 'Instaqueue Min', type: 'number' },
  { key: 'instaqueue_max', label: 'Instaqueue Max', type: 'number' },
  { key: 'locked', label: 'Locked', type: 'boolean' },
]

export function QueueSettingsClient() {
  const router = useRouter()
  const utils = api.useUtils()
  const [editingQueue, setEditingQueue] = useState<QueueSettings | null>(null)
  const [isLockAllDialogOpen, setIsLockAllDialogOpen] = useState(false)
  const [formData, setFormData] = useState<EditableFields>({})

  const { data: queues, isLoading } = api.queues.getSettings.useQuery()

  const updateSettings = api.queues.updateSettings.useMutation({
    onSuccess: async () => {
      toast.success('Queue updated')
      await utils.queues.getSettings.invalidate()
      setEditingQueue(null)
      setFormData({})
      startTransition(() => router.refresh())
    },
    onError: (error) => toast.error(error.message),
  })

  const lockAllQueues = api.queues.lockAll.useMutation({
    onSuccess: async ({ count }) => {
      toast.success(count === 1 ? 'Locked 1 queue' : `Locked ${count} queues`)
      setIsLockAllDialogOpen(false)
      await utils.queues.getSettings.invalidate()
      startTransition(() => router.refresh())
    },
    onError: (error) => toast.error(error.message),
  })

  function openEdit(queue: QueueSettings) {
    setEditingQueue(queue)
    setFormData({
      queue_desc: queue.queue_desc,
      queue_icon: queue.queue_icon,
      color: queue.color,
      default_elo: queue.default_elo,
      members_per_team: queue.members_per_team,
      number_of_teams: queue.number_of_teams,
      elo_search_start: queue.elo_search_start,
      elo_search_increment: queue.elo_search_increment,
      elo_search_speed: queue.elo_search_speed,
      max_party_elo_difference: queue.max_party_elo_difference,
      best_of_allowed: queue.best_of_allowed,
      first_deck_ban_num: queue.first_deck_ban_num,
      second_deck_ban_num: queue.second_deck_ban_num,
      use_tuple_bans: queue.use_tuple_bans,
      veto_mmr_threshold: queue.veto_mmr_threshold,
      instaqueue_min: queue.instaqueue_min,
      instaqueue_max: queue.instaqueue_max,
      locked: queue.locked,
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingQueue) return

    // Only send changed fields
    const changes: EditableFields = {}
    for (const field of FIELD_CONFIG) {
      const key = field.key as keyof EditableFields
      const newVal = formData[key]
      const oldVal = editingQueue[key as keyof QueueSettings]
      if (newVal !== oldVal) {
        ;(changes as Record<string, unknown>)[key] = newVal
      }
    }

    if (Object.keys(changes).length === 0) {
      toast.info('No changes')
      setEditingQueue(null)
      return
    }

    updateSettings.mutate({ id: editingQueue.id, settings: changes })
  }

  function updateField(key: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  if (isLoading) {
    return (
      <div className='text-muted-foreground text-sm'>Loading queues...</div>
    )
  }

  if (!queues?.length) {
    return <div className='text-muted-foreground text-sm'>No queues found</div>
  }

  const unlockedQueueCount = queues.filter((queue) => !queue.locked).length
  const isMutating = updateSettings.isPending || lockAllQueues.isPending

  return (
    <>
      <div className='flex justify-end'>
        <Button
          disabled={unlockedQueueCount === 0 || isMutating}
          variant={'destructive'}
          onClick={() => setIsLockAllDialogOpen(true)}
        >
          {lockAllQueues.isPending
            ? 'Locking...'
            : unlockedQueueCount === 0
              ? 'All Queues Locked'
              : 'Lock All Queues'}
        </Button>
        <Dialog
          open={isLockAllDialogOpen}
          onOpenChange={setIsLockAllDialogOpen}
        >
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>Lock all queues?</DialogTitle>
              <DialogDescription>
                This will lock {unlockedQueueCount} currently open
                {unlockedQueueCount === 1 ? ' queue' : ' queues'} and clear any
                players waiting in them.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                disabled={isMutating}
                onClick={() => setIsLockAllDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type='button'
                variant='destructive'
                onClick={() => lockAllQueues.mutate()}
                disabled={isMutating}
              >
                {lockAllQueues.isPending ? 'Locking...' : 'Lock All Queues'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {queues.map((queue) => (
          <div
            key={queue.id}
            className='flex flex-col gap-3 rounded-lg border bg-background p-4'
          >
            <div className='flex items-start justify-between gap-2'>
              <div className='flex min-w-0 flex-1 items-center gap-2'>
                {queue.queue_icon ? (
                  <DiscordEmoji
                    value={queue.queue_icon}
                    className='h-5 w-5 text-lg'
                  />
                ) : null}
                <h3 className='min-w-0 truncate font-semibold text-base'>
                  {queue.queue_name}
                </h3>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {queue.locked ? (
                  <Badge variant='destructive'>Locked</Badge>
                ) : (
                  <Badge variant='outline'>Open</Badge>
                )}
                <div
                  className='h-4 w-4 rounded-full border'
                  style={{ backgroundColor: queue.color || '#FFD700' }}
                  title={queue.color}
                />
              </div>
            </div>

            {queue.queue_desc ? (
              <p className='line-clamp-2 text-muted-foreground text-sm'>
                {queue.queue_desc}
              </p>
            ) : null}

            <div className='grid grid-cols-2 gap-x-4 gap-y-1 text-sm'>
              <Stat label='Default ELO' value={queue.default_elo} />
              <Stat
                label='Team Size'
                value={`${queue.members_per_team}v${queue.members_per_team}`}
              />
              <Stat label='Teams' value={queue.number_of_teams} />
              <Stat label='Search Start' value={queue.elo_search_start} />
              <Stat label='Search Inc' value={queue.elo_search_increment} />
              <Stat label='Search Speed' value={`${queue.elo_search_speed}s`} />
              <Stat
                label='Party ELO Diff'
                value={queue.max_party_elo_difference ?? '—'}
              />
              <Stat
                label='Best-of'
                value={queue.best_of_allowed ? 'Yes' : 'No'}
              />
              <Stat label='Deck Bans' value={queue.first_deck_ban_num} />
              <Stat label='Deck Picks' value={queue.second_deck_ban_num} />
              <Stat
                label='Tuple Bans'
                value={queue.use_tuple_bans ? 'Yes' : 'No'}
              />
              <Stat label='Veto MMR' value={queue.veto_mmr_threshold ?? '—'} />
              <Stat
                label='Instaqueue'
                value={`${queue.instaqueue_min}–${queue.instaqueue_max}`}
              />
            </div>

            <Button
              variant='outline'
              size='sm'
              className='mt-auto'
              onClick={() => openEdit(queue)}
            >
              Edit
            </Button>
          </div>
        ))}
      </div>

      <Dialog
        open={editingQueue !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingQueue(null)
            setFormData({})
          }
        }}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              <span className='inline-flex items-center gap-2'>
                <span>Edit</span>
                {editingQueue?.queue_icon ? (
                  <DiscordEmoji
                    value={editingQueue.queue_icon}
                    className='h-5 w-5 text-lg'
                  />
                ) : null}
                <span>{editingQueue?.queue_name}</span>
              </span>
            </DialogTitle>
            <DialogDescription>
              Changes are applied immediately to the bot.
            </DialogDescription>
          </DialogHeader>

          <form className='flex flex-col gap-4' onSubmit={handleSubmit}>
            {FIELD_CONFIG.map((field) => {
              const key = field.key as keyof EditableFields
              const value = formData[key]

              if (field.type === 'boolean') {
                return (
                  <div
                    key={field.key}
                    className='flex items-center justify-between gap-2'
                  >
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <Switch
                      id={field.key}
                      checked={value as boolean}
                      onCheckedChange={(checked) =>
                        updateField(field.key, checked)
                      }
                      disabled={isMutating}
                    />
                  </div>
                )
              }

              if (field.type === 'color') {
                return (
                  <div key={field.key} className='grid gap-2'>
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <div className='flex items-center gap-2'>
                      <input
                        type='color'
                        id={`${field.key}-picker`}
                        value={(value as string) || '#FFD700'}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        className='h-9 w-9 cursor-pointer rounded border-0 bg-transparent p-0'
                        disabled={isMutating}
                      />
                      <Input
                        id={field.key}
                        value={(value as string) ?? ''}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        placeholder='#FFD700'
                        disabled={isMutating}
                        className='flex-1'
                      />
                    </div>
                  </div>
                )
              }

              if (field.type === 'number') {
                return (
                  <div key={field.key} className='grid gap-2'>
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <Input
                      id={field.key}
                      type='number'
                      value={
                        value === null || value === undefined
                          ? ''
                          : String(value)
                      }
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '' && field.nullable) {
                          updateField(field.key, null)
                        } else {
                          const num = Number(raw)
                          if (!Number.isNaN(num)) updateField(field.key, num)
                        }
                      }}
                      placeholder={field.nullable ? 'None' : undefined}
                      disabled={isMutating}
                    />
                  </div>
                )
              }

              return (
                <div key={field.key} className='grid gap-2'>
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    value={(value as string) ?? ''}
                    onChange={(e) =>
                      updateField(
                        field.key,
                        e.target.value || (field.nullable ? null : '')
                      )
                    }
                    placeholder={field.nullable ? 'None' : undefined}
                    disabled={isMutating}
                  />
                </div>
              )
            })}

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  setEditingQueue(null)
                  setFormData({})
                }}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isMutating}>
                {updateSettings.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-right font-medium'>{value}</span>
    </>
  )
}
