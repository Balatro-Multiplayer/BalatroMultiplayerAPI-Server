'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmCard } from '@/components/admin/confirm-card'
import { Button } from '@/components/ui/button'
import { ApiError, apiFetch, apiFetchWithReason } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { ModDetailCard } from './components/mod-detail-card'
import { ModFormDialog } from './components/mod-form-dialog'
import { ModsTable } from './components/mods-table'
import { PinCommitDialog } from './components/pin-commit-dialog'
import { ProfileEntriesDialog } from './components/profile-entries-dialog'
import { ProfileFormDialog } from './components/profile-form-dialog'
import { ProfilesTable } from './components/profiles-table'
import {
  emptyModForm,
  emptyProfileForm,
  formFromDetail,
  formToBody,
  type ModDetail,
  type ModForm,
  type ModPatch,
  type ModProfile,
  type ModProfileVersionMode,
  type ModSummary,
  type ProfileForm,
} from './components/ranked-mods-types'
import {
  type ModFilter,
  filterMods,
  modDeleteImpact,
  profileDeleteImpact,
} from './lib/mods-view'

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
// attested to the server at queue time. Separately, each pin's SMODS ids
// (read from its files at pin time, editable here) make up the mod allowlist
// Nakama checks a player's reported mods against before every matchmaking
// queue: an unpinned mod keeps its players out of matchmaking. Below the
// catalog, the mod profiles: named mod lists the launcher offers as presets
// (GET /api/mods/profiles), read by the launcher as-is.
export default function RankedModsPage() {
  const { isAdmin, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()

  // An admin page: the server sends moderators nothing from it.
  const canView = isAdmin

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
      return apiFetchWithReason(`/webadmin/mods/${encodeURIComponent(input.modId)}`, {
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
  const [filter, setFilter] = useState<ModFilter>('pinned')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
        return apiFetchWithReason(
          `/webadmin/mods/${encodeURIComponent(dialog.editing.id)}/custom`,
          { method: 'PUT', body }
        )
      }
      return apiFetchWithReason('/webadmin/mods', { method: 'POST', body })
    },
    onSuccess: () => {
      setDialog(null)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
      qc.invalidateQueries({ queryKey: ['mod-versions'] })
    },
    onError: onErr,
  })

  const deleteModMut = useMutation({
    mutationFn: ({ mod, note }: { mod: ModSummary; note: string }) =>
      apiFetchWithReason(
        `/webadmin/mods/${encodeURIComponent(mod.id)}`,
        { method: 'DELETE' },
        note
      ),
    onSuccess: () => {
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
      // Deleting a mod removes its entries from every profile.
      invalidateProfiles()
    },
    onError: onErr,
  })

  // Manually kicks off the same Thunderstore sync that otherwise only runs
  // at server startup and hourly (see mods-sync.service.ts server-side) —
  // e.g. to pull in a newly-published mod without waiting for the next tick.
  const syncMut = useMutation({
    mutationFn: () =>
      apiFetchWithReason<{
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

  // Reads the SMODS ids of pins made before they were read at pin time
  // (smods-ids-backfill.service.ts server-side) and pushes the allowlist.
  const backfillMut = useMutation({
    mutationFn: () =>
      apiFetchWithReason<{
        ok: true
        read: number
        failed: number
        skipped: number
        queueAllowedModIds: string[]
      }>('/webadmin/mods/smods-ids/backfill', { method: 'POST' }),
    onSuccess: (result) => {
      const summary =
        `Read SMODS ids for ${result.read} pins` +
        (result.failed ? ` (${result.failed} failed -- see server logs)` : '')
      if (result.failed) toast.error(summary)
      else toast.success(summary)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
  })

  const { data: profiles, isLoading: profilesLoading } = useQuery<
    ModProfile[]
  >({
    queryKey: ['mod-profiles'],
    queryFn: () => apiFetch('/webadmin/mods/profiles'),
    enabled: canView,
  })
  const invalidateProfiles = () =>
    qc.invalidateQueries({ queryKey: ['mod-profiles'] })

  // `editing` is null while creating. The entries dialog keeps only the id,
  // so it shows the refetched profile after each change.
  const [profileDialog, setProfileDialog] = useState<null | {
    editing: ModProfile | null
  }>(null)
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm)
  const [entriesProfileId, setEntriesProfileId] = useState<string | null>(null)
  const [deleteProfileTarget, setDeleteProfileTarget] =
    useState<ModProfile | null>(null)

  const openProfileEdit = (profile: ModProfile | null) => {
    setProfileForm(
      profile
        ? {
            name: profile.name,
            slug: profile.slug,
            description: profile.description ?? '',
          }
        : emptyProfileForm
    )
    setProfileDialog({ editing: profile })
  }

  const saveProfileMut = useMutation({
    mutationFn: async () => {
      if (!profileDialog) return
      const body = JSON.stringify({
        name: profileForm.name,
        slug: profileForm.slug,
        description: profileForm.description || null,
      })
      if (profileDialog.editing) {
        return apiFetchWithReason(
          `/webadmin/mods/profiles/${encodeURIComponent(profileDialog.editing.id)}`,
          { method: 'PUT', body }
        )
      }
      return apiFetchWithReason('/webadmin/mods/profiles', { method: 'POST', body })
    },
    onSuccess: () => {
      setProfileDialog(null)
      invalidateProfiles()
    },
    onError: onErr,
  })

  const deleteProfileMut = useMutation({
    mutationFn: ({ profile, note }: { profile: ModProfile; note: string }) =>
      apiFetchWithReason(
        `/webadmin/mods/profiles/${encodeURIComponent(profile.id)}`,
        { method: 'DELETE' },
        note
      ),
    onSuccess: () => {
      setDeleteProfileTarget(null)
      invalidateProfiles()
    },
    onError: onErr,
  })

  const entryPath = (profileId: string, modId: string) =>
    `/webadmin/mods/profiles/${encodeURIComponent(profileId)}/entries/${encodeURIComponent(modId)}`

  const setEntryMut = useMutation({
    mutationFn: (input: {
      profileId: string
      modId: string
      versionMode: ModProfileVersionMode
      pinnedVersion: string | null
      allowed: boolean
    }) =>
      apiFetchWithReason(entryPath(input.profileId, input.modId), {
        method: 'PUT',
        body: JSON.stringify({
          versionMode: input.versionMode,
          pinnedVersion: input.pinnedVersion,
          allowed: input.allowed,
        }),
      }),
    onSuccess: invalidateProfiles,
    onError: onErr,
  })

  const removeEntryMut = useMutation({
    mutationFn: (input: { profileId: string; modId: string }) =>
      apiFetchWithReason(entryPath(input.profileId, input.modId), { method: 'DELETE' }),
    onSuccess: invalidateProfiles,
    onError: onErr,
  })

  if (pending || !canView) return null

  const visibleMods = filterMods(mods ?? [], filter, search)
  const selected =
    visibleMods.find((m) => m.id === selectedId) ?? visibleMods[0]
  const modBusy = pendingModId === selected?.id || deleteModMut.isPending

  let confirmCard = null
  if (deleteTarget) {
    const impact = modDeleteImpact(deleteTarget, profiles ?? [])
    confirmCard = (
      <ConfirmCard
        key={`mod-${deleteTarget.id}`}
        title={`Delete ${deleteTarget.title}?`}
        rows={[
          {
            label: 'Pinned mod',
            value: impact.pinnedVersion ? (
              <>
                <s className='text-muted-foreground'>{impact.pinnedVersion}</s>{' '}
                to gone, with its versions
              </>
            ) : (
              'Not pinned. Its versions are deleted.'
            ),
          },
          {
            label: 'Allowed mods',
            value:
              impact.allowedIds.length > 0
                ? `${impact.allowedIds.join(', ')} leaves the list. Ranked players with it are refused.`
                : 'No change',
          },
          {
            label: 'Profiles',
            value:
              impact.profiles.length > 0
                ? `Removed from ${impact.profiles.length}: ${impact.profiles.map((p) => p.slug).join(', ')}`
                : 'No change',
          },
        ]}
        placeholder='Why delete this mod?'
        confirmLabel='Delete mod'
        pending={deleteModMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(note) => deleteModMut.mutate({ mod: deleteTarget, note })}
      />
    )
  } else if (deleteProfileTarget) {
    const impact = profileDeleteImpact(deleteProfileTarget, mods ?? [])
    confirmCard = (
      <ConfirmCard
        key={`profile-${deleteProfileTarget.id}`}
        title={`Delete profile ${deleteProfileTarget.name}?`}
        rows={[
          {
            label: 'Profile',
            value: (
              <>
                <s className='text-muted-foreground'>
                  {deleteProfileTarget.slug}
                </s>{' '}
                to gone. The launcher stops offering it.
              </>
            ),
          },
          {
            label: 'Mods in it',
            value:
              impact.modTitles.length > 0
                ? impact.modTitles.join(', ')
                : 'None',
          },
          {
            label: 'Allowed mods',
            value: 'No change. The mods stay in the catalog.',
          },
        ]}
        placeholder='Why delete this profile?'
        confirmLabel='Delete profile'
        pending={deleteProfileMut.isPending}
        onCancel={() => setDeleteProfileTarget(null)}
        onConfirm={(note) =>
          deleteProfileMut.mutate({ profile: deleteProfileTarget, note })
        }
      />
    )
  }

  const entriesProfile =
    profiles?.find((p) => p.id === entriesProfileId) ?? null

  const unavailablePins =
    mods?.filter((m) => m.rankedDownloadStatus === 'unavailable') ?? []

  return (
    <div className='container max-w-[110rem] space-y-6 py-8'>
      <div className='text-muted-foreground text-sm'>
        Staff / Ops / <span className='text-primary'>Ranked Mods</span>
      </div>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div className='flex flex-wrap items-baseline gap-x-4'>
          <h1 className='font-pixel text-4xl'>Ranked Mods</h1>
          <p className='max-w-xl text-muted-foreground text-sm'>
            Catalog synced hourly from Thunderstore, plus custom mods. A pinned
            mod is fixed at one version and checked against a hash taken at pin
            time.
          </p>
        </div>
        {isAdmin && (
          <div className='flex gap-2'>
            <Button size='sm' variant='outline' onClick={openCreate}>
              New custom mod
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => backfillMut.mutate()}
              disabled={backfillMut.isPending}
              title='Read the SMODS ids of pins that have none yet'
            >
              {backfillMut.isPending ? 'Reading…' : 'Read SMODS ids'}
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
      </div>

      {unavailablePins.length > 0 && (
        <p className='rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive text-sm'>
          <b>
            {unavailablePins.length === 1
              ? '1 pinned mod can no longer be downloaded'
              : `${unavailablePins.length} pinned mods can no longer be downloaded`}
          </b>{' '}
          ({unavailablePins.map((m) => m.title).join(', ')}). Players cannot
          launch Ranked with {unavailablePins.length === 1 ? 'it' : 'them'}{' '}
          until an admin pins again.
        </p>
      )}

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_28rem]'>
        <div className='space-y-6'>
          <section className='rounded-xl border border-border bg-card p-4'>
            {modsLoading || !mods ? (
              <p className='text-muted-foreground text-sm'>Loading…</p>
            ) : (
              <ModsTable
                allMods={mods}
                mods={visibleMods}
                filter={filter}
                search={search}
                selectedId={selected?.id ?? null}
                isAdmin={isAdmin}
                pendingModId={pendingModId}
                onFilter={setFilter}
                onSearch={setSearch}
                onSelect={(m) => setSelectedId(m.id)}
                onUpdate={(mod, patch) =>
                  updateModMut.mutate({ modId: mod.id, patch })
                }
              />
            )}
          </section>

          <section className='space-y-3 rounded-xl border border-border bg-card p-4'>
            <div className='flex items-center justify-between gap-2'>
              <div>
                <h2 className='font-pixel text-lg'>Mod profiles</h2>
                <p className='text-muted-foreground text-sm'>
                  Named mod lists the launcher offers as presets. Changes reach
                  the launcher at once.
                </p>
              </div>
              {isAdmin && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => openProfileEdit(null)}
                >
                  New profile
                </Button>
              )}
            </div>
            {profilesLoading || !profiles ? (
              <p className='text-muted-foreground text-sm'>Loading…</p>
            ) : (
              <ProfilesTable
                profiles={profiles}
                isAdmin={isAdmin}
                onManageEntries={(p) => setEntriesProfileId(p.id)}
                onEdit={openProfileEdit}
                onDelete={(p) => {
                  setDeleteTarget(null)
                  setDeleteProfileTarget(p)
                }}
              />
            )}
          </section>
        </div>

        <div className='space-y-6'>
          <ModDetailCard
            mod={selected}
            isAdmin={isAdmin}
            busy={modBusy}
            onUpdate={(mod, patch) =>
              updateModMut.mutate({ modId: mod.id, patch })
            }
            onPinCommit={setPinCommitTarget}
            onEdit={openEdit}
            onDelete={(m) => {
              setDeleteProfileTarget(null)
              setDeleteTarget(m)
            }}
          />
          {confirmCard}
        </div>
      </div>

      <ProfileFormDialog
        open={profileDialog !== null}
        mode={profileDialog?.editing ? 'edit' : 'create'}
        form={profileForm}
        isPending={saveProfileMut.isPending}
        onFormChange={setProfileForm}
        onSave={() => saveProfileMut.mutate()}
        onClose={() => setProfileDialog(null)}
      />
      <ProfileEntriesDialog
        profile={entriesProfile}
        mods={mods ?? []}
        isAdmin={isAdmin}
        isPending={setEntryMut.isPending || removeEntryMut.isPending}
        onSetEntry={(modId, versionMode, pinnedVersion, allowed) =>
          entriesProfile &&
          setEntryMut.mutate({
            profileId: entriesProfile.id,
            modId,
            versionMode,
            pinnedVersion,
            allowed,
          })
        }
        onRemoveEntry={(modId) =>
          entriesProfile &&
          removeEntryMut.mutate({ profileId: entriesProfile.id, modId })
        }
        onClose={() => setEntriesProfileId(null)}
      />
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
    </div>
  )
}
