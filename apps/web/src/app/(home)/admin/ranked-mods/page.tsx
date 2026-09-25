'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { ModsTable } from './components/mods-table'
import type { ModSummary } from './components/ranked-mods-types'

// The ranked mod catalog -- synced hourly straight from Thunderstore (see
// BalatroMultiplayerServer's features/mods/mods-sync.service.ts). The only
// thing editable here is rankedVersion: null means not ranked-allowed, any
// other value pins that mod to exactly that Thunderstore version (hashed at
// pin time -- see mods.gateway.ts's setRankedVersion doc comment).
// Deliberately distinct from /admin/config's "Official Mods" section above
// (the pre-existing launcher self-update channel, mod_versions/mod_releases)
// -- this is a separate system (mod_registry). Info-only for now: nothing
// cross-checks a client's actual installed mods against this at queue time
// yet.
export default function RankedModsPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()

  const canView = isAdmin || isModerator

  useEffect(() => {
    if (!pending && !canView) router.replace('/')
  }, [pending, canView, router])

  const onErr = (e: unknown) =>
    toast.error(
      e instanceof ApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Request failed'
    )

  const { data: mods, isLoading: modsLoading } = useQuery<ModSummary[]>({
    queryKey: ['ranked-mods'],
    queryFn: () => apiFetch('/webadmin/mods'),
    enabled: canView,
  })

  const [pendingModId, setPendingModId] = useState<string | null>(null)

  const setRankedVersionMut = useMutation({
    mutationFn: async (input: {
      modId: string
      rankedVersion: string | null
    }) => {
      setPendingModId(input.modId)
      return apiFetch(`/webadmin/mods/${encodeURIComponent(input.modId)}`, {
        method: 'PUT',
        body: JSON.stringify({ rankedVersion: input.rankedVersion }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ranked-mods'] }),
    onError: onErr,
    onSettled: () => setPendingModId(null),
  })

  // Manually kicks off the same Thunderstore sync that otherwise only runs
  // at server startup and hourly (see mods-sync.service.ts server-side) —
  // e.g. to pull in a newly-published mod without waiting for the next tick.
  const syncMut = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; modsSynced: number; pruned: number; skipped: number }>(
        '/webadmin/mods/sync',
        { method: 'POST' }
      ),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.modsSynced} mods` +
          (result.pruned ? ` (${result.pruned} pruned)` : '') +
          (result.skipped ? ` (${result.skipped} skipped)` : '')
      )
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
  })

  if (pending || !canView) return null

  return (
    <div className='container max-w-4xl space-y-6 py-8'>
      <div className='space-y-1'>
        <h1 className='font-bold text-2xl tracking-tight'>Ranked Mods</h1>
        <p className='text-muted-foreground'>
          Mod catalog synced hourly from Thunderstore. Info-only for now — no
          queue-time enforcement yet.
        </p>
      </div>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle>Mod catalog</CardTitle>
            <CardDescription>
              Ranked eligibility and an optional pinned ranked version are set
              here directly.
            </CardDescription>
          </div>
          {isAdmin && (
            <Button
              size='sm'
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
            >
              {syncMut.isPending ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {modsLoading || !mods ? (
            <p className='text-muted-foreground text-sm'>Loading…</p>
          ) : (
            <ModsTable
              mods={mods}
              isAdmin={isAdmin}
              pendingModId={pendingModId}
              onSetRankedVersion={(mod, version) =>
                setRankedVersionMut.mutate({
                  modId: mod.id,
                  rankedVersion: version,
                })
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
