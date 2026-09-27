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
import { DeleteModDialog } from './components/delete-mod-dialog'
import { ModFormDialog } from './components/mod-form-dialog'
import { ModsTable } from './components/mods-table'
import { PinCommitDialog } from './components/pin-commit-dialog'
import {
  emptyModForm,
  formFromDetail,
  formToBody,
  type ModDetail,
  type ModForm,
  type ModPatch,
  type ModSummary,
} from './components/ranked-mods-types'

// The ranked mod catalog -- synced hourly straight from Thunderstore (see
// BalatroMultiplayerServer's features/mods/mods-sync.service.ts), plus
// admin-created custom mods (no Thunderstore package). Editable on every
// mod: the ranked pin (null means not ranked-allowed; any version of the
// merged Thunderstore + GitHub list, or a commit by SHA, pins the mod to
// exactly that version's permanent download, hashed at pin time -- see
// mods.gateway.ts's setRankedVersion doc comment), featured, hidden (drops
// the mod from the public catalog) and trackGithub. The sync never changes a
// pin; it flags one whose download disappeared as unavailable. Custom mods can additionally be
// created, edited and deleted; a Thunderstore mod's own fields are read-only.
// Deliberately distinct from /admin/config's "Official Mods" section above
// (the pre-existing launcher self-update channel, mod_versions/mod_releases)
// -- this is a separate system (mod_registry). Ranked status is enforced by
// the launcher (it hashes installed mods against the pinned hash) and
// attested to the server at queue time, not checked by the server itself.
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

  const updateModMut = useMutation({
    mutationFn: async (input: { modId: string; patch: ModPatch }) => {
      setPendingModId(input.modId)
      return apiFetch(`/webadmin/mods/${encodeURIComponent(input.modId)}`, {
        method: 'PUT',
        body: JSON.stringify(input.patch),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ranked-mods'] }),
    onError: onErr,
    onSettled: () => setPendingModId(null),
  })

  // Custom-mod dialog: `editing` is the mod being edited (null while
  // creating); `initialForm` is what the dialog opened with, so an edit only
  // re-resolves a branch/release source the admin actually changed.
  const [dialog, setDialog] = useState<null | {
    mode: 'create' | 'edit'
    editing: ModSummary | null
  }>(null)
  const [form, setForm] = useState<ModForm>(emptyModForm)
  const [initialForm, setInitialForm] = useState<ModForm>(emptyModForm)
  const [deleteTarget, setDeleteTarget] = useState<ModSummary | null>(null)
  const [pinCommitTarget, setPinCommitTarget] = useState<ModSummary | null>(
    null
  )

  const openCreate = () => {
    setForm(emptyModForm)
    setInitialForm(emptyModForm)
    setDialog({ mode: 'create', editing: null })
  }

  const openEdit = async (mod: ModSummary) => {
    try {
      const detail = await apiFetch<ModDetail>(
        `/webadmin/mods/${encodeURIComponent(mod.id)}`
      )
      const prefilled = formFromDetail(detail)
      setForm(prefilled)
      setInitialForm(prefilled)
      setDialog({ mode: 'edit', editing: mod })
    } catch (e) {
      onErr(e)
    }
  }

  const saveModMut = useMutation({
    mutationFn: async () => {
      if (!dialog) return
      const body = JSON.stringify(formToBody(form, dialog.mode, initialForm))
      if (dialog.editing) {
        return apiFetch(
          `/webadmin/mods/${encodeURIComponent(dialog.editing.id)}/custom`,
          { method: 'PUT', body }
        )
      }
      return apiFetch('/webadmin/mods', { method: 'POST', body })
    },
    onSuccess: () => {
      setDialog(null)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
      qc.invalidateQueries({ queryKey: ['mod-versions'] })
    },
    onError: onErr,
  })

  const deleteModMut = useMutation({
    mutationFn: (mod: ModSummary) =>
      apiFetch(`/webadmin/mods/${encodeURIComponent(mod.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
  })

  // Manually kicks off the same Thunderstore sync that otherwise only runs
  // at server startup and hourly (see mods-sync.service.ts server-side) —
  // e.g. to pull in a newly-published mod without waiting for the next tick.
  const syncMut = useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: true
        modsSynced: number
        pruned: number
        skipped: number
        pinsUnavailable: number
      }>('/webadmin/mods/sync', { method: 'POST' }),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.modsSynced} mods` +
          (result.pruned ? ` (${result.pruned} pruned)` : '') +
          (result.skipped ? ` (${result.skipped} skipped)` : '') +
          (result.pinsUnavailable
            ? ` (${result.pinsUnavailable} ranked pins unavailable)`
            : '')
      )
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
  })

  if (pending || !canView) return null

  const unavailablePins =
    mods?.filter((m) => m.rankedDownloadStatus === 'unavailable') ?? []

  return (
    <div className='container max-w-4xl space-y-6 py-8'>
      <div className='space-y-1'>
        <h1 className='font-bold text-2xl tracking-tight'>Ranked Mods</h1>
        <p className='text-muted-foreground'>
          Mod catalog synced hourly from Thunderstore, plus custom mods added
          here. Ranked pins are verified by the launcher against a hash taken at
          pin time.
        </p>
      </div>

      {unavailablePins.length > 0 && (
        <p className='rounded-md border border-destructive/50 px-4 py-3 text-destructive text-sm'>
          {unavailablePins.length === 1
            ? '1 ranked pin can no longer be downloaded'
            : `${unavailablePins.length} ranked pins can no longer be downloaded`}{' '}
          ({unavailablePins.map((m) => m.title).join(', ')}). Players can't
          launch Ranked with those mods until an admin re-pins them.
        </p>
      )}

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle>Mod catalog</CardTitle>
            <CardDescription>
              Ranked version pins, featured and hidden are set here directly.
              Only custom mods can be edited or deleted.
            </CardDescription>
          </div>
          {isAdmin && (
            <div className='flex gap-2'>
              <Button size='sm' variant='outline' onClick={openCreate}>
                New custom mod
              </Button>
              <Button
                size='sm'
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
              >
                {syncMut.isPending ? 'Syncing…' : 'Sync now'}
              </Button>
            </div>
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
              onUpdate={(mod, patch) =>
                updateModMut.mutate({ modId: mod.id, patch })
              }
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onPinCommit={setPinCommitTarget}
            />
          )}
        </CardContent>
      </Card>

      <ModFormDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        form={form}
        isPending={saveModMut.isPending}
        onFormChange={setForm}
        onSave={() => saveModMut.mutate()}
        onClose={() => setDialog(null)}
      />
      <PinCommitDialog
        target={pinCommitTarget}
        isPending={updateModMut.isPending}
        onConfirm={(sha) =>
          pinCommitTarget &&
          updateModMut.mutate(
            { modId: pinCommitTarget.id, patch: { rankedCommit: sha } },
            {
              onSuccess: () => {
                setPinCommitTarget(null)
                qc.invalidateQueries({ queryKey: ['mod-versions'] })
              },
            }
          )
        }
        onClose={() => setPinCommitTarget(null)}
      />
      <DeleteModDialog
        target={deleteTarget}
        isPending={deleteModMut.isPending}
        onConfirm={() => deleteTarget && deleteModMut.mutate(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
