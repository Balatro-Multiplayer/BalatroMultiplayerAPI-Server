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
import { Input } from '@/components/ui/input'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { DeleteModDialog } from './components/delete-mod-dialog'
import { DeleteProfileDialog } from './components/delete-profile-dialog'
import { ModFormDialog } from './components/mod-form-dialog'
import { ModsTable } from './components/mods-table'
import { ProfileEntriesDialog } from './components/profile-entries-dialog'
import { ProfileFormDialog } from './components/profile-form-dialog'
import { ProfilesTable } from './components/profiles-table'
import type {
  ModDetail,
  ModForm,
  ModProfile,
  ModProfileDetail,
  ModProfileVersionMode,
  ModSummary,
  ProfileForm,
} from './components/ranked-mods-types'
import {
  EMPTY_MOD_FORM,
  EMPTY_PROFILE_FORM,
  extractBranchName,
} from './components/ranked-mods-types'

// The ranked mod catalog -- base mod data synced hourly straight from
// skyline69/balatro-mod-index (see BalatroMultiplayerServer's
// features/mods/mods-sync.service.ts), with ranked eligibility, a pinned
// ranked version, a featured flag, and fully custom (non-index) mod entries
// all editable here instead of requiring a commit/PR/CI round trip through
// that repo -- plus admin-authored ranked mod profiles. Edits to a
// synced (non-custom) mod's own fields are recorded as per-field overrides
// (see mods.gateway.ts's updateModFields/upsertModFromIndex doc comments) so
// the next hourly sync doesn't clobber them.
// Deliberately distinct from /admin/config's "Official Mods" section above
// (the pre-existing launcher self-update channel, mod_versions/mod_releases)
// -- this is a separate system (mod_registry/mod_profiles). Info-only for
// now: nothing cross-checks a client's actual installed mods against this at
// queue time yet.
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

  // Reads from /webadmin/mods rather than the public /mods -- the public
  // route (and its gateway default) excludes hidden mods, and this table
  // needs to keep showing/managing them (see mods.gateway.ts's
  // listPublicMods includeHidden doc comment).
  const { data: mods, isLoading: modsLoading } = useQuery<ModSummary[]>({
    queryKey: ['ranked-mods'],
    queryFn: () => apiFetch('/webadmin/mods'),
    enabled: canView,
  })

  const [pendingModId, setPendingModId] = useState<string | null>(null)

  // Client-side filter over the already-loaded catalog (this page fetches
  // every mod up front already, see the `mods` query above) - matches
  // against name/id and each mod's admin-set searchTerms (e.g. "wimf" for
  // "What's in my Fool"), case-insensitive substring on each. No server
  // round trip per keystroke; the catalog is small enough (admin-authored +
  // one hourly sync's worth of mods) that this stays instant.
  const [modSearch, setModSearch] = useState('')
  const filteredMods = (mods ?? []).filter((mod) => {
    const q = modSearch.trim().toLowerCase()
    if (!q) return true
    return (
      mod.name.toLowerCase().includes(q) ||
      mod.id.toLowerCase().includes(q) ||
      mod.searchTerms.some((term) => term.toLowerCase().includes(q))
    )
  })

  // rankedVersion is the sole ranked-eligibility signal now -- null un-ranks
  // a mod, any other value ranks it and pins it to exactly that version
  // (validated server-side against sourceType, see webadmin mods.route.ts's
  // PUT handler doc comment). Setting it to null goes through the same PUT
  // as any other value rather than the separate DELETE .../ranked endpoint
  // -- both work, but ModsTable's dropdown always has a concrete next value
  // (including "None"), so there's never a reason to hit the DELETE path
  // from this page.
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

  const setFeaturedMut = useMutation({
    mutationFn: async (input: { modId: string; featured: boolean }) => {
      setPendingModId(input.modId)
      return apiFetch(`/webadmin/mods/${encodeURIComponent(input.modId)}`, {
        method: 'PUT',
        body: JSON.stringify({ featured: input.featured }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ranked-mods'] }),
    onError: onErr,
    onSettled: () => setPendingModId(null),
  })

  const setHiddenMut = useMutation({
    mutationFn: async (input: { modId: string; hidden: boolean }) => {
      setPendingModId(input.modId)
      return apiFetch(`/webadmin/mods/${encodeURIComponent(input.modId)}`, {
        method: 'PUT',
        body: JSON.stringify({ hidden: input.hidden }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ranked-mods'] }),
    onError: onErr,
    onSettled: () => setPendingModId(null),
  })

  // --- Mod create/edit dialog (custom mods + field overrides on any mod) ---

  // Turns a form into the PATCH/POST field payload -- shared by create and
  // edit so both stay in sync about what "empty" means per field (empty
  // string -> null for optional text fields, comma-split for categories).
  // Branch/Release mode sends a structured sourceInput instead of a raw
  // latestDownloadUrl - the server resolves the real URL (+ latestVersion)
  // itself (see custom-mod-version-check.service.ts's resolveSourceInput),
  // rather than asking the admin to hand-type one of mod-source-classifier.ts's
  // regex-shaped URL conventions.
  function modFormToFields(form: ModForm) {
    const base = {
      title: form.title,
      author: form.author,
      categories: form.categories
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      searchTerms: form.searchTerms
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      requiresSteamodded: form.requiresSteamodded,
      requiresTalisman: form.requiresTalisman,
      repoUrl: form.repoUrl || null,
      thumbnailUrl: form.thumbnailUrl || null,
      description: form.description || null,
      automaticVersionCheck: form.automaticVersionCheck,
    }
    if (form.sourceType === 'branch') {
      return {
        ...base,
        sourceInput: {
          sourceType: 'branch' as const,
          repoUrl: form.repoUrl,
          branch: form.branch || 'main',
        },
      }
    }
    if (form.sourceType === 'release') {
      return {
        ...base,
        sourceInput: { sourceType: 'release' as const, repoUrl: form.repoUrl },
      }
    }
    return {
      ...base,
      latestVersion: form.latestVersion || null,
      latestDownloadUrl: form.latestDownloadUrl || null,
    }
  }

  // Only the fields that actually changed from what was loaded -- editing
  // just the description shouldn't also pin title/author/etc as overrides
  // (see mods.gateway.ts's updateModFields: every key present in the PATCH
  // body gets folded into overriddenFields). sourceInput is a plain object,
  // not a primitive, so it needs the same JSON-stringify comparison as
  // categories -- otherwise a same-content-but-freshly-built object would
  // always look "changed" (different reference every render) and every
  // save of a Branch/Release mod would re-resolve from GitHub even when
  // nothing actually changed.
  function diffModFields(original: ModForm, current: ModForm) {
    const o = modFormToFields(original)
    const c = modFormToFields(current)
    const out: Partial<typeof c> = {}
    for (const key of Object.keys(c) as (keyof typeof c)[]) {
      const ov = o[key]
      const cv = c[key]
      const changed =
        typeof cv === 'object' && cv !== null
          ? JSON.stringify(cv) !== JSON.stringify(ov)
          : cv !== ov
      if (changed) (out as Record<string, unknown>)[key] = cv
    }
    return out
  }

  const [modDialog, setModDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; id: string } | null
  >(null)
  const [modForm, setModForm] = useState<ModForm>(EMPTY_MOD_FORM)
  const [originalModForm, setOriginalModForm] =
    useState<ModForm>(EMPTY_MOD_FORM)

  const { data: editModDetail } = useQuery<ModDetail>({
    queryKey: ['mod-detail', modDialog?.mode === 'edit' ? modDialog.id : null],
    queryFn: () =>
      apiFetch(
        `/webadmin/mods/${encodeURIComponent(modDialog?.mode === 'edit' ? modDialog.id : '')}`
      ),
    enabled: modDialog?.mode === 'edit',
  })

  useEffect(() => {
    if (!editModDetail) return
    const loaded: ModForm = {
      id: editModDetail.id,
      title: editModDetail.title,
      author: editModDetail.author,
      categories: editModDetail.categories.join(', '),
      searchTerms: editModDetail.searchTerms.join(', '),
      requiresSteamodded: editModDetail.requiresSteamodded,
      requiresTalisman: editModDetail.requiresTalisman,
      repoUrl: editModDetail.repoUrl ?? '',
      thumbnailUrl: editModDetail.thumbnailUrl ?? '',
      description: editModDetail.description ?? '',
      // sourceType comes straight from the server (already computed from
      // the mod's current latestDownloadUrl) rather than reclassifying it
      // client-side - see extractBranchName's own comment on why the
      // branch name still needs pulling out separately.
      sourceType: editModDetail.sourceType,
      branch: extractBranchName(editModDetail.latestDownloadUrl),
      latestVersion: editModDetail.latestVersion ?? '',
      latestDownloadUrl: editModDetail.latestDownloadUrl ?? '',
      automaticVersionCheck: editModDetail.automaticVersionCheck,
    }
    setModForm(loaded)
    setOriginalModForm(loaded)
  }, [editModDetail])

  const createModMut = useMutation({
    mutationFn: (form: ModForm) =>
      apiFetch('/webadmin/mods', {
        method: 'POST',
        body: JSON.stringify({ id: form.id, ...modFormToFields(form) }),
      }),
    onSuccess: () => {
      toast.success('Custom mod created')
      setModDialog(null)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
  })

  const updateModFieldsMut = useMutation({
    mutationFn: ({ modId, fields }: { modId: string; fields: object }) =>
      apiFetch(`/webadmin/mods/${encodeURIComponent(modId)}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }),
    onSuccess: (_data, { modId }) => {
      toast.success('Mod updated')
      setModDialog(null)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
      qc.invalidateQueries({ queryKey: ['mod-detail', modId] })
    },
    onError: onErr,
  })

  const resetOverridesMut = useMutation({
    mutationFn: (modId: string) =>
      apiFetch(`/webadmin/mods/${encodeURIComponent(modId)}/reset-overrides`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (_data, modId) => {
      toast.success('Overrides reset — next sync restores upstream values')
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
      qc.invalidateQueries({ queryKey: ['mod-detail', modId] })
    },
    onError: onErr,
  })

  const [deleteModTarget, setDeleteModTarget] = useState<ModSummary | null>(
    null
  )
  const deleteModMut = useMutation({
    mutationFn: (modId: string) =>
      apiFetch(`/webadmin/mods/${encodeURIComponent(modId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success('Mod deleted')
      setDeleteModTarget(null)
      qc.invalidateQueries({ queryKey: ['ranked-mods'] })
    },
    onError: onErr,
  })

  // Manually kicks off the same upstream sync + hash-check pass that
  // otherwise only runs at server startup and hourly (see mods-sync.service.ts
  // server-side) — e.g. to confirm a mod's hash updated right after a new
  // release, without waiting for the next tick.
  const syncMut = useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: true
        modsSynced: number
        hashed: number
        pruned: number
        skipped: number
        idCollisions: number
        versionsChecked: number
      }>('/webadmin/mods/sync', { method: 'POST' }),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.modsSynced} mods` +
          (result.hashed ? ` (${result.hashed} newly hashed)` : '') +
          (result.pruned ? ` (${result.pruned} pruned)` : '') +
          (result.versionsChecked
            ? ` (${result.versionsChecked} custom mod versions updated)`
            : '')
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
      versionMode,
      pinnedVersion,
      allowed,
    }: {
      profileId: string
      modId: string
      versionMode: ModProfileVersionMode
      pinnedVersion: string | null
      allowed: boolean
    }) =>
      apiFetch(
        `/webadmin/mods/profiles/${profileId}/entries/${encodeURIComponent(modId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ versionMode, pinnedVersion, allowed }),
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
          Mod catalog synced hourly from skyline69/balatro-mod-index, plus
          admin-authored ranked mod profiles. Info-only for now — no queue-time
          enforcement yet.
        </p>
      </div>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle>Mod catalog</CardTitle>
            <CardDescription>
              Ranked eligibility, an optional pinned ranked version, and every
              other field are set here directly — edits to a synced mod's field
              are pinned against future syncs until reset.
            </CardDescription>
          </div>
          {isAdmin && (
            <div className='flex gap-2'>
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  setModForm(EMPTY_MOD_FORM)
                  setOriginalModForm(EMPTY_MOD_FORM)
                  setModDialog({ mode: 'create' })
                }}
              >
                New mod
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
        <CardContent className='space-y-4'>
          <Input
            value={modSearch}
            onChange={(e) => setModSearch(e.target.value)}
            placeholder='Search by name, id, or alternative search term (e.g. wimf)…'
            className='max-w-sm'
          />
          {modsLoading || !mods ? (
            <p className='text-muted-foreground text-sm'>Loading…</p>
          ) : (
            <ModsTable
              mods={filteredMods}
              isAdmin={isAdmin}
              pendingModId={pendingModId}
              emptyMessage={
                modSearch.trim() && mods.length > 0
                  ? `No mods match "${modSearch.trim()}"`
                  : undefined
              }
              onSetRankedVersion={(mod, version) =>
                setRankedVersionMut.mutate({
                  modId: mod.id,
                  rankedVersion: version,
                })
              }
              onSetFeatured={(mod, featured) =>
                setFeaturedMut.mutate({ modId: mod.id, featured })
              }
              onSetHidden={(mod, hidden) =>
                setHiddenMut.mutate({ modId: mod.id, hidden })
              }
              onEdit={(mod) => setModDialog({ mode: 'edit', id: mod.id })}
              onDelete={(modId) => {
                const mod = mods.find((m) => m.id === modId)
                if (mod) setDeleteModTarget(mod)
              }}
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

      <ModFormDialog
        open={modDialog !== null}
        mode={modDialog?.mode ?? 'create'}
        form={modForm}
        overriddenFields={editModDetail?.overriddenFields ?? []}
        isPending={createModMut.isPending || updateModFieldsMut.isPending}
        isResetPending={resetOverridesMut.isPending}
        onFormChange={setModForm}
        onSave={() => {
          if (modDialog?.mode === 'edit') {
            const fields = diffModFields(originalModForm, modForm)
            if (Object.keys(fields).length === 0) {
              setModDialog(null)
              return
            }
            updateModFieldsMut.mutate({ modId: modDialog.id, fields })
          } else {
            createModMut.mutate(modForm)
          }
        }}
        onReset={() =>
          modDialog?.mode === 'edit' && resetOverridesMut.mutate(modDialog.id)
        }
        onClose={() => setModDialog(null)}
      />

      <DeleteModDialog
        target={deleteModTarget}
        isPending={deleteModMut.isPending}
        onConfirm={() =>
          deleteModTarget && deleteModMut.mutate(deleteModTarget.id)
        }
        onClose={() => setDeleteModTarget(null)}
      />

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
        onUpsertEntry={(modId, versionMode, pinnedVersion, allowed) =>
          entriesProfileId &&
          entryMut.mutate({
            profileId: entriesProfileId,
            modId,
            versionMode,
            pinnedVersion,
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
