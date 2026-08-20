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
  GithubReleaseOption,
  LauncherPlatform,
  LauncherRelease,
} from './components/launcher-releases-types'

interface ReleasesResponse {
  releases: LauncherRelease[]
}

interface GithubReleasesResponse {
  releases: GithubReleaseOption[]
}

// Admin surface for the new (private) launcher's releases -- see this
// server's features/launcher/launcher.route.ts for the public
// GET /api/launcher/latest + download endpoints these imports feed. The
// launcher's repo is private for anti-cheat reasons, so end users can't be
// pointed at its GitHub Releases directly, but its own CI already builds
// and uploads every platform binary there - this page just imports a
// chosen release's asset metadata (not the binaries themselves, which stay
// on GitHub and get proxied on download) rather than re-uploading them here.
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

  const githubReleasesQ = useQuery<GithubReleasesResponse>({
    queryKey: ['admin-launcher-releases-github'],
    queryFn: () => apiFetch('/webadmin/launcher-releases/github-releases'),
    enabled: canAccess,
  })
  const githubReleases = githubReleasesQ.data?.releases ?? []

  const onErr = (e: unknown) =>
    toast.error(
      e instanceof ApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Request failed'
    )
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-launcher-releases'] })
    qc.invalidateQueries({ queryKey: ['admin-launcher-releases-github'] })
  }

  const importMut = useMutation({
    mutationFn: (tag: string) =>
      apiFetch('/webadmin/launcher-releases/from-github', {
        method: 'POST',
        body: JSON.stringify({ tag }),
      }),
    onSuccess: () => {
      toast.success('Release imported')
      invalidate()
    },
    onError: onErr,
  })

  // Re-runs the same import against a release's already-stored tag - all
  // platforms come from one GitHub release together, so there's no more
  // "just replace Mac" - this just re-pulls current metadata for all of them.
  const resyncMut = useMutation({
    mutationFn: (release: LauncherRelease) => {
      setPendingReleaseId(release.id)
      return apiFetch('/webadmin/launcher-releases/from-github', {
        method: 'POST',
        body: JSON.stringify({ tag: release.githubReleaseTag }),
      })
    },
    onSuccess: () => {
      toast.success('Release re-synced from GitHub')
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
        onResync={(release) => resyncMut.mutate(release)}
        onDeletePlatform={(release, platform) =>
          deletePlatformMut.mutate({ release, platform })
        }
        onDeleteRelease={setDeleteTarget}
      />

      <AddReleaseForm
        githubReleases={githubReleases}
        isLoadingGithubReleases={githubReleasesQ.isLoading}
        isPending={importMut.isPending}
        onSubmit={(tag) => importMut.mutate(tag)}
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
