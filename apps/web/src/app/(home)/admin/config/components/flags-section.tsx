'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { apiFetchWithReason } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { type FeatureFlag, changedFlags } from '../lib/drafts'
import { SaveBar } from './save-bar'
import { SectionFrame } from './section-frame'

export const FEATURE_FLAGS: {
  key: FeatureFlag
  label: string
  description: string
}[] = [
  {
    key: 'chatEnabled',
    label: 'Text Chat',
    description: 'Lobby chat sends are rejected when off.',
  },
  {
    key: 'rankedEnabled',
    label: 'Ranked Queue',
    description: 'Ranked matchmaking requests are rejected when off.',
  },
  {
    key: 'casualQueueEnabled',
    label: 'Casual Queue',
    description: 'Casual matchmaking requests are rejected when off.',
  },
  {
    key: 'groupQueueEnabled',
    label: 'Group Queue',
    description:
      'Private lobbies queueing casual together are rejected when off.',
  },
  {
    key: 'lobbyCreationEnabled',
    label: 'Lobby Creation',
    description: 'Manual lobby creation is rejected when off.',
  },
  {
    key: 'achievementsEnabled',
    label: 'Avatar Achievements',
    description: 'Games count toward unlocking avatars. On by default.',
  },
]

export function FlagsSection({
  saved,
  queueAllowedModIds,
  testingMode,
  onDirtyChange,
  onSaved,
}: {
  saved: Record<FeatureFlag, boolean>
  queueAllowedModIds: string[]
  testingMode: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(saved)
  const changes = changedFlags(saved, draft)
  const count = Object.keys(changes).length
  useEffect(() => onDirtyChange(count > 0), [count, onDirtyChange])

  const save = useMutation({
    mutationFn: (note: string) =>
      apiFetchWithReason(
        '/webadmin/config/feature-flags',
        { method: 'PATCH', body: JSON.stringify(changes) },
        note,
      ),
    onSuccess: () => toast.success('Feature flags saved'),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Request failed'),
    onSettled: onSaved,
  })

  return (
    <SectionFrame
      testId='config-flags'
      title='Feature flags'
      description='A flag takes effect at once when saved, with no deploy.'
      footer={
        <SaveBar
          changeCount={count}
          pending={save.isPending}
          saveLabel='Save feature flags'
          onSave={(note) => save.mutate(note)}
          onReset={() => setDraft(saved)}
        />
      }
    >
      <div className='space-y-4'>
        {FEATURE_FLAGS.map((flag) => (
          <div
            key={flag.key}
            className='flex items-center justify-between gap-3'
          >
            <div className='space-y-0.5'>
              <Label htmlFor={flag.key}>
                {flag.label}
                {saved[flag.key] !== draft[flag.key] && (
                  <span className='ml-2 text-bal-gold text-xs'>changed</span>
                )}
              </Label>
              <p className='text-muted-foreground text-sm'>
                {flag.description}
              </p>
            </div>
            <Switch
              id={flag.key}
              checked={draft[flag.key]}
              disabled={save.isPending}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, [flag.key]: checked }))
              }
            />
          </div>
        ))}
        <div className='border-border border-t pt-3 text-muted-foreground text-sm'>
          Matchmaking allows only these mod ids (from ranked pins, Ranked Mods
          page), plus Balatro, Steamodded and Lovely. Private lobbies are never
          checked:{' '}
          <span className='font-mono'>
            {queueAllowedModIds.length > 0
              ? queueAllowedModIds.join(', ')
              : 'none yet'}
          </span>
        </div>
        <div className='border-border border-t pt-3 text-muted-foreground text-sm'>
          Testing mode:{' '}
          <span className='font-semibold'>{testingMode ? 'Yes' : 'No'}</span>.
          It is set by an environment variable at deploy time, so it cannot be
          edited here.
        </div>
      </div>
    </SectionFrame>
  )
}
