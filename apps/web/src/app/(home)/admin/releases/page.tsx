'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AddReleaseForm } from './components/add-release-form'
import { DeleteReleaseDialog } from './components/delete-release-dialog'
import { LauncherReleasesTable } from './components/launcher-releases-table'
import type {
  LauncherPlatform,
  LauncherRelease,
} from './components/launcher-releases-types'

interface ReleasesResponse {
  releases: LauncherRelease[]
}

// Admin surface for the new (private) launcher's binaries -- see this
// server's features/launcher/launcher.route.ts for the public
// GET /api/launcher/latest + download endpoints these uploads feed. The
// launcher's repo is private for anti-cheat reasons, so it can't use GitHub
// Releases the way the old public launcher did; this server hosts the
// binaries itself instead.
export default function AdminReleasesPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator

  const [deleteTarget, setDeleteTarget] = useState<LauncherRelease | null>(null)
  const [pendingReleaseId, setPendingReleaseId] = useState<number | null>(null)

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const releasesQ = useQuery<ReleasesResponse>({
    queryKey: ['admin-launcher-releases'],
    queryFn: () => apiFetch('/webadmin/launcher-releases'),
    enabled: canAccess,
  })
  const releases = releasesQ.data?.releases ?? []

  const onErr = (e: unknown) =>
    toast.error(
      e instanceof ApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Request failed'
    )
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['admin-launcher-releases'] })

  const uploadMut = useMutation({
    mutationFn: (formData: FormData) =>
      apiFetch('/webadmin/launcher-releases', {
        method: 'POST',
        body: formData,
      }),
    onSuccess: () => {
      toast.success('Release uploaded')
      invalidate()
    },
    onError: onErr,
  })

  const platformUploadMut = useMutation({
    mutationFn: ({
      release,
      platform,
      file,
    }: {
      release: LauncherRelease
      platform: LauncherPlatform
      file: File
    }) => {
      setPendingReleaseId(release.id)
      const formData = new FormData()
      formData.set('version', release.version)
      formData.set(platform, file)
      return apiFetch('/webadmin/launcher-releases', {
        method: 'POST',
        body: formData,
      })
    },
    onSuccess: () => {
      toast.success('Binary uploaded')
      invalidate()
    },
    onError: onErr,
    onSettled: () => setPendingReleaseId(null),
  })

  const deletePlatformMut = useMutation({
    mutationFn: ({
      release,
      platform,
    }: {
      release: LauncherRelease
      platform: LauncherPlatform
    }) => {
      setPendingReleaseId(release.id)
      return apiFetch(`/webadmin/launcher-releases/${release.id}/${platform}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      toast.success('Binary removed')
      invalidate()
    },
    onError: onErr,
    onSettled: () => setPendingReleaseId(null),
  })

  const deleteReleaseMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/webadmin/launcher-releases/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Release deleted')
      setDeleteTarget(null)
      invalidate()
    },
    onError: onErr,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  return (
    <div className='container max-w-6xl space-y-8 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>Launcher Releases</h1>
        <p className='text-muted-foreground text-sm'>
          Binaries served at <code>/api/launcher/latest</code> and{' '}
          <code>/api/launcher/download/:version/:platform</code>.
        </p>
      </div>

      <LauncherReleasesTable
        releases={releases}
        isLoading={releasesQ.isLoading}
        pendingReleaseId={pendingReleaseId}
        onUpload={(release, platform, file) =>
          platformUploadMut.mutate({ release, platform, file })
        }
        onDeletePlatform={(release, platform) =>
          deletePlatformMut.mutate({ release, platform })
        }
        onDeleteRelease={setDeleteTarget}
      />

      <AddReleaseForm
        isPending={uploadMut.isPending}
        onSubmit={(formData) => uploadMut.mutate(formData)}
      />

      <DeleteReleaseDialog
        target={deleteTarget}
        isPending={deleteReleaseMut.isPending}
        onConfirm={() =>
          deleteTarget && deleteReleaseMut.mutate(deleteTarget.id)
        }
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
