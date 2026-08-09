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
import { DeleteProfileDialog } from './components/delete-profile-dialog'
import { ModsTable } from './components/mods-table'
import { ProfileEntriesDialog } from './components/profile-entries-dialog'
import { ProfileFormDialog } from './components/profile-form-dialog'
import { ProfilesTable } from './components/profiles-table'
import type {
  ModProfile,
  ModProfileDetail,
  ModSummary,
  ProfileForm,
} from './components/ranked-mods-types'
import { EMPTY_PROFILE_FORM } from './components/ranked-mods-types'

// The ranked mod catalog (synced hourly from BETModIndex — see
// BalatroMultiplayerAPI-Server's features/mods/mods-sync.service.ts) and
// admin-authored ranked mod profiles. Deliberately distinct from
// /admin/config's "Official Mods" section above (the pre-existing launcher
// self-update channel, mod_versions/mod_releases) — this is a separate
// system (mod_registry/mod_profiles) for ranked-eligibility data. Info-only
// for now: nothing cross-checks a client's actual installed mods against a
// profile at queue time yet.
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

  // --- Mods ---

  const { data: mods, isLoading: modsLoading } = useQuery<ModSummary[]>({
    queryKey: ['ranked-mods'],
    queryFn: () => apiFetch('/mods'),
    enabled: canView,
  })

  const [pendingModId, setPendingModId] = useState<string | null>(null)

  const toggleMut = useMutation({
    mutationFn: async ({
      modId,
      allowed,
    }: {
      modId: string
      allowed: boolean
    }) => {
      setPendingModId(modId)
      return apiFetch(`/webadmin/mods/${encodeURIComponent(modId)}`, {
        method: 'PUT',
        body: JSON.stringify({ allowedInRanked: allowed }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ranked-mods'] }),
    onError: onErr,
    onSettled: () => setPendingModId(null),
  })

  const resetOverrideMut = useMutation({
    mutationFn: async (modId: string) => {
      setPendingModId(modId)
      return apiFetch(
        `/webadmin/mods/${encodeURIComponent(modId)}/manual-override`,
        { method: 'DELETE' }
      )
    },
    onSuccess: () => {
      toast.success('Reset to BETModIndex value — next sync will apply')
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
    onSettled: () => setPendingModId(null),
  })

  // Manually kicks off the same BETModIndex sync + hash-check pass that
  // otherwise only runs at server startup and hourly (see mods-sync.service.ts
  // server-side) — e.g. to confirm a mod's hash updated right after a new
  // release, without waiting for the next tick.
  const syncMut = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; modsSynced: number; hashed: number; pruned: number }>(
        '/webadmin/mods/sync',
        { method: 'POST' }
      ),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.modsSynced} mods` +
          (result.hashed ? ` (${result.hashed} newly hashed)` : '') +
          (result.pruned ? ` (${result.pruned} pruned)` : '')
      )
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
  })

  // --- Profiles ---

  const { data: profiles } = useQuery<ModProfile[]>({
    queryKey: ['ranked-mod-profiles'],
    queryFn: () => apiFetch('/webadmin/mods/profiles'),
    enabled: canView,
  })

  const invalidateProfiles = () =>
    qc.invalidateQueries({ queryKey: ['ranked-mod-profiles'] })

  const [profileDialog, setProfileDialog] = useState<{
    mode: 'create' | 'edit'
    id?: string
  } | null>(null)
  const [profileForm, setProfileForm] =
    useState<ProfileForm>(EMPTY_PROFILE_FORM)

  const createProfileMut = useMutation({
    mutationFn: (form: ProfileForm) =>
      apiFetch('/webadmin/mods/profiles', {
        method: 'POST',
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      toast.success('Profile created')
      setProfileDialog(null)
      invalidateProfiles()
    },
    onError: onErr,
  })

  const updateProfileMut = useMutation({
    mutationFn: ({ id, form }: { id: string; form: ProfileForm }) =>
      apiFetch(`/webadmin/mods/profiles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      toast.success('Profile updated')
      setProfileDialog(null)
      invalidateProfiles()
    },
    onError: onErr,
  })

  const [deleteTarget, setDeleteTarget] = useState<ModProfile | null>(null)
  const deleteProfileMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/webadmin/mods/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Profile deleted')
      setDeleteTarget(null)
      invalidateProfiles()
    },
    onError: onErr,
  })

  // --- Profile entries ---

  const [entriesProfileId, setEntriesProfileId] = useState<string | null>(null)
  const { data: entriesProfile } = useQuery<ModProfileDetail>({
    queryKey: ['ranked-mod-profile', entriesProfileId],
    queryFn: () => apiFetch(`/webadmin/mods/profiles/${entriesProfileId}`),
    enabled: entriesProfileId !== null,
  })

  const entryMut = useMutation({
    mutationFn: ({
      profileId,
      modId,
      versionConstraint,
      allowed,
    }: {
      profileId: string
      modId: string
      versionConstraint: string
      allowed: boolean
    }) =>
      apiFetch(
        `/webadmin/mods/profiles/${profileId}/entries/${encodeURIComponent(modId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ versionConstraint, allowed }),
        }
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['ranked-mod-profile', entriesProfileId],
      }),
    onError: onErr,
  })

  const removeEntryMut = useMutation({
    mutationFn: ({ profileId, modId }: { profileId: string; modId: string }) =>
      apiFetch(
        `/webadmin/mods/profiles/${profileId}/entries/${encodeURIComponent(modId)}`,
        { method: 'DELETE' }
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['ranked-mod-profile', entriesProfileId],
      }),
    onError: onErr,
  })

  if (pending || !canView) return null

  return (
    <div className='container max-w-4xl space-y-6 py-8'>
      <div className='space-y-1'>
        <h1 className='font-bold text-2xl tracking-tight'>Ranked Mods</h1>
        <p className='text-muted-foreground'>
          Mod catalog synced from BETModIndex, plus admin-authored ranked mod
          profiles. Info-only for now — no queue-time enforcement yet.
        </p>
      </div>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle>Mod catalog</CardTitle>
            <CardDescription>
              "Allowed in ranked" toggled here overrides BETModIndex until reset.
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
              onToggle={(mod, allowed) =>
                toggleMut.mutate({ modId: mod.id, allowed })
              }
              onResetOverride={(modId) => resetOverrideMut.mutate(modId)}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle>Ranked mod profiles</CardTitle>
            <CardDescription>
              Named allow/deny lists an admin composes.
            </CardDescription>
          </div>
          {isAdmin && (
            <Button
              size='sm'
              onClick={() => {
                setProfileForm(EMPTY_PROFILE_FORM)
                setProfileDialog({ mode: 'create' })
              }}
            >
              New profile
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <ProfilesTable
            profiles={profiles ?? []}
            isAdmin={isAdmin}
            onManageEntries={(profile) => setEntriesProfileId(profile.id)}
            onEdit={(profile) => {
              setProfileForm({
                name: profile.name,
                slug: profile.slug,
                description: profile.description ?? '',
              })
              setProfileDialog({ mode: 'edit', id: profile.id })
            }}
            onDelete={(profile) => setDeleteTarget(profile)}
          />
        </CardContent>
      </Card>

      <ProfileFormDialog
        open={profileDialog !== null}
        mode={profileDialog?.mode ?? 'create'}
        form={profileForm}
        isPending={createProfileMut.isPending || updateProfileMut.isPending}
        onFormChange={setProfileForm}
        onSave={() => {
          if (profileDialog?.mode === 'edit' && profileDialog.id) {
            updateProfileMut.mutate({ id: profileDialog.id, form: profileForm })
          } else {
            createProfileMut.mutate(profileForm)
          }
        }}
        onClose={() => setProfileDialog(null)}
      />

      <DeleteProfileDialog
        target={deleteTarget}
        isPending={deleteProfileMut.isPending}
        onConfirm={() =>
          deleteTarget && deleteProfileMut.mutate(deleteTarget.id)
        }
        onClose={() => setDeleteTarget(null)}
      />

      <ProfileEntriesDialog
        profile={entriesProfile ?? null}
        mods={mods ?? []}
        isPending={entryMut.isPending || removeEntryMut.isPending}
        onUpsertEntry={(modId, versionConstraint, allowed) =>
          entriesProfileId &&
          entryMut.mutate({
            profileId: entriesProfileId,
            modId,
            versionConstraint,
            allowed,
          })
        }
        onRemoveEntry={(modId) =>
          entriesProfileId &&
          removeEntryMut.mutate({ profileId: entriesProfileId, modId })
        }
        onClose={() => setEntriesProfileId(null)}
      />
    </div>
  )
}
