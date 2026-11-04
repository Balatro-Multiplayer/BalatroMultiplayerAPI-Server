'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { LADDER_LABELS, LADDER_STEPS, LADDERS, type Ladder, type LadderStep, STEP_LABELS } from '../players/lib/strikes'

interface ModEntry {
  modId: string
  displayName: string
  version: string
  downloadUrl: string
}

interface ConfigResponse {
  noticeVersion: number
  noticeDate: string
  mods: ModEntry[]
  chatAllowlist: string[]
  chatEnabled: boolean
  testingMode: boolean
  rankedEnabled: boolean
  casualQueueEnabled: boolean
  groupQueueEnabled: boolean
  lobbyCreationEnabled: boolean
  achievementsEnabled: boolean
  // The SMODS ids of every ranked-pinned mod (Ranked Mods page).
  queueAllowedModIds: string[]
  strikeLadders: Record<Ladder, LadderStep[]>
}

type FeatureFlag =
  | 'chatEnabled'
  | 'rankedEnabled'
  | 'casualQueueEnabled'
  | 'groupQueueEnabled'
  | 'lobbyCreationEnabled'
  | 'achievementsEnabled'

const FEATURE_FLAGS: { key: FeatureFlag; label: string; description: string }[] = [
  { key: 'chatEnabled', label: 'Text Chat', description: 'Lobby chat sends are rejected when off.' },
  { key: 'rankedEnabled', label: 'Ranked Queue', description: 'Ranked matchmaking requests are rejected when off.' },
  { key: 'casualQueueEnabled', label: 'Casual Queue', description: 'Casual matchmaking requests are rejected when off.' },
  { key: 'groupQueueEnabled', label: 'Group Queue', description: 'Private lobbies queueing casual together are rejected when off.' },
  { key: 'lobbyCreationEnabled', label: 'Lobby Creation', description: 'Manual lobby creation is rejected when off.' },
  {
    key: 'achievementsEnabled',
    label: 'Avatar Achievements',
    description: 'Games count toward unlocking avatars. On by default.',
  },
]

export default function AdminConfigPage() {
  const { isAdmin, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()

  // An admin page: the server sends moderators nothing from it.
  const canView = isAdmin

  useEffect(() => {
    if (!pending && !canView) router.replace('/')
  }, [pending, canView, router])

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ['admin-config'],
    queryFn: () => apiFetch('/webadmin/config'),
    enabled: canView,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-config'] })
  const onErr = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Request failed')

  const flagsMut = useMutation({
    mutationFn: (patch: Partial<Pick<ConfigResponse, FeatureFlag>>) =>
      apiFetch('/webadmin/config/feature-flags', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      toast.success('Feature flag updated')
      invalidate()
    },
    onError: onErr,
  })

  // One draft per ladder: the steps in order, and the reason for the edit.
  const [ladderDrafts, setLadderDrafts] = useState<Partial<Record<Ladder, LadderStep[]>>>({})
  const [ladderReason, setLadderReason] = useState('')
  const saveLadderMut = useMutation({
    mutationFn: ({ ladder, steps }: { ladder: Ladder; steps: LadderStep[] }) =>
      apiFetch(`/webadmin/config/strike-ladders/${ladder}`, {
        method: 'PUT',
        body: JSON.stringify({ steps, reason: ladderReason }),
      }),
    onSuccess: (_result, { ladder }) => {
      toast.success('Strike ladder saved')
      setLadderDrafts((d) => ({ ...d, [ladder]: undefined }))
      setLadderReason('')
      invalidate()
    },
    onError: onErr,
  })

  const [modForm, setModForm] = useState({ modId: '', displayName: '', version: '', downloadUrl: '' })
  const upsertModMut = useMutation({
    mutationFn: (mod: ModEntry) =>
      apiFetch(`/webadmin/config/mods/${encodeURIComponent(mod.modId)}`, {
        method: 'PUT',
        body: JSON.stringify({ displayName: mod.displayName, version: mod.version, downloadUrl: mod.downloadUrl }),
      }),
    onSuccess: () => {
      toast.success('Mod entry saved')
      setModForm({ modId: '', displayName: '', version: '', downloadUrl: '' })
      invalidate()
    },
    onError: onErr,
  })

  const deleteModMut = useMutation({
    mutationFn: (modId: string) => apiFetch(`/webadmin/config/mods/${encodeURIComponent(modId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Mod entry removed')
      invalidate()
    },
    onError: onErr,
  })

  const [allowlistMessage, setAllowlistMessage] = useState('')
  const addAllowlistMut = useMutation({
    mutationFn: (message: string) =>
      apiFetch('/webadmin/config/chat-allowlist', { method: 'POST', body: JSON.stringify({ message }) }),
    onSuccess: () => {
      toast.success('Added to chat allowlist')
      setAllowlistMessage('')
      invalidate()
    },
    onError: onErr,
  })

  const removeAllowlistMut = useMutation({
    mutationFn: (message: string) =>
      apiFetch(`/webadmin/config/chat-allowlist/${encodeURIComponent(message)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Removed from chat allowlist')
      invalidate()
    },
    onError: onErr,
  })

  if (pending || !canView) return null

  return (
    <div className='container max-w-3xl py-8 space-y-6'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-bold tracking-tight'>Platform Configuration</h1>
        <p className='text-muted-foreground'>Edits here take effect immediately (no redeploy).</p>
      </div>

      {isLoading || !data ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Notice</CardTitle>
              <CardDescription>
                Set in code (packages/types/src/notice.ts). A deploy with a higher version asks every player to accept again.
              </CardDescription>
            </CardHeader>
            <CardContent className='text-sm'>
              Version {data.noticeVersion}, dated {data.noticeDate}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Official Mods</CardTitle>
              <CardDescription>Changing a mod's version broadcasts an update notice to connected clients.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {data.mods.map((mod) => (
                <div key={mod.modId} className='flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm'>
                  <div>
                    <p className='font-semibold'>{mod.displayName} <span className='text-muted-foreground font-mono text-xs'>({mod.modId})</span></p>
                    <p className='text-muted-foreground'>v{mod.version} — {mod.downloadUrl}</p>
                  </div>
                  {isAdmin && (
                    <Button variant='outline' size='sm' onClick={() => deleteModMut.mutate(mod.modId)} disabled={deleteModMut.isPending}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {isAdmin && (
                <div className='grid grid-cols-2 gap-3 border-t border-border pt-4'>
                  <Input placeholder='Mod ID' value={modForm.modId} onChange={(e) => setModForm({ ...modForm, modId: e.target.value })} />
                  <Input placeholder='Display Name' value={modForm.displayName} onChange={(e) => setModForm({ ...modForm, displayName: e.target.value })} />
                  <Input placeholder='Version' value={modForm.version} onChange={(e) => setModForm({ ...modForm, version: e.target.value })} />
                  <Input placeholder='Download URL' value={modForm.downloadUrl} onChange={(e) => setModForm({ ...modForm, downloadUrl: e.target.value })} />
                  <Button
                    className='col-span-2'
                    disabled={upsertModMut.isPending || !modForm.modId || !modForm.displayName || !modForm.version || !modForm.downloadUrl}
                    onClick={() => upsertModMut.mutate(modForm)}
                  >
                    {upsertModMut.isPending ? 'Saving…' : 'Add / Update Mod'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chat Allowlist</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex flex-wrap gap-2'>
                {data.chatAllowlist.length === 0 && <p className='text-sm text-muted-foreground'>Empty.</p>}
                {data.chatAllowlist.map((message) => (
                  <span key={message} className='inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm'>
                    {message}
                    {isAdmin && (
                      <button
                        type='button'
                        className='text-muted-foreground hover:text-destructive'
                        onClick={() => removeAllowlistMut.mutate(message)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {isAdmin && (
                <div className='flex gap-2'>
                  <Input
                    placeholder='New allowed message'
                    value={allowlistMessage}
                    onChange={(e) => setAllowlistMessage(e.target.value)}
                    className='max-w-xs'
                  />
                  <Button
                    disabled={addAllowlistMut.isPending || !allowlistMessage.trim()}
                    onClick={() => addAllowlistMut.mutate(allowlistMessage)}
                  >
                    Add
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strike Ladders</CardTitle>
              <CardDescription>
                The next step on a ladder is the recommended punishment. The last step must be permanent. Each edit goes in the staff log.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {LADDERS.map((ladder) => {
                const steps = ladderDrafts[ladder] ?? data.strikeLadders[ladder]
                const edit = (next: LadderStep[]) => setLadderDrafts((d) => ({ ...d, [ladder]: next }))
                return (
                  <div key={ladder} className='space-y-2' data-testid={`ladder-${ladder}`}>
                    <Label>{LADDER_LABELS[ladder]}</Label>
                    <div className='flex flex-wrap items-center gap-2'>
                      {steps.map((step, i) => (
                        <span key={`${step}-${i}`} className='inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm'>
                          {i + 1}. {STEP_LABELS[step]}
                          <button
                            type='button'
                            className='text-muted-foreground hover:text-destructive'
                            onClick={() => edit(steps.filter((_, j) => j !== i))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {LADDER_STEPS.map((step) => (
                        <Button key={step} size='sm' variant='outline' onClick={() => edit([...steps, step])}>
                          + {STEP_LABELS[step]}
                        </Button>
                      ))}
                    </div>
                    {ladderDrafts[ladder] && (
                      <div className='flex gap-2'>
                        <Input
                          placeholder='Reason for the change (staff log)'
                          value={ladderReason}
                          onChange={(e) => setLadderReason(e.target.value)}
                          className='max-w-sm'
                        />
                        <Button
                          disabled={saveLadderMut.isPending || !ladderReason.trim()}
                          onClick={() => saveLadderMut.mutate({ ladder, steps })}
                        >
                          Save
                        </Button>
                        <Button variant='ghost' onClick={() => setLadderDrafts((d) => ({ ...d, [ladder]: undefined }))}>
                          Reset
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Feature Flags</CardTitle>
              <CardDescription>Take effect immediately, no redeploy needed.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {FEATURE_FLAGS.map((flag) => (
                <div key={flag.key} className='flex items-center justify-between gap-3'>
                  <div className='space-y-0.5'>
                    <Label htmlFor={flag.key}>{flag.label}</Label>
                    <p className='text-sm text-muted-foreground'>{flag.description}</p>
                  </div>
                  <Switch
                    id={flag.key}
                    checked={data[flag.key]}
                    disabled={!isAdmin || flagsMut.isPending}
                    onCheckedChange={(checked) => flagsMut.mutate({ [flag.key]: checked })}
                  />
                </div>
              ))}
              <div className='border-t border-border pt-3 text-sm text-muted-foreground'>
                Matchmaking allows only these mod ids (from ranked pins, Ranked Mods page), plus Balatro, Steamodded and Lovely; private lobbies are never checked:{' '}
                <span className='font-mono'>
                  {data.queueAllowedModIds.length > 0 ? data.queueAllowedModIds.join(', ') : 'none yet'}
                </span>
              </div>
              <div className='border-t border-border pt-3 text-sm text-muted-foreground'>
                Testing mode: <span className='font-semibold'>{data.testingMode ? 'Yes' : 'No'}</span> (set via environment variable at deploy time — not editable here)
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
