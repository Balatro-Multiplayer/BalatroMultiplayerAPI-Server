'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmCard } from '@/components/admin/confirm-card'
import { ApiError, apiFetch, apiFetchWithReason } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AddReleaseForm } from './components/add-release-form'
import { LauncherReleasesTable } from './components/launcher-releases-table'
import {
  type GithubReleaseOption,
  type LauncherPlatform,
  type LauncherRelease,
  PLATFORM_LABELS,
  PLATFORMS,
} from './components/launcher-releases-types'
import { ReleaseDetailCard } from './components/release-detail-card'

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
  const { isAdmin, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  // An admin page: the server sends moderators nothing from it.
  const canAccess = isAdmin

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<
    | { kind: 'release'; release: LauncherRelease }
    | { kind: 'file'; release: LauncherRelease; platform: LauncherPlatform }
    | null
  >(null)
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

  const selected = releases.find((r) => r.id === selectedId) ?? releases[0]

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
      apiFetchWithReason('/webadmin/launcher-releases/from-github', {
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
      return apiFetchWithReason('/webadmin/launcher-releases/from-github', {
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
      note,
    }: {
      release: LauncherRelease
      platform: LauncherPlatform
      note: string
    }) =>
      apiFetchWithReason(
        `/webadmin/launcher-releases/${release.id}/${platform}`,
        { method: 'DELETE' },
        note
      ),
    onSuccess: () => {
      toast.success('File removed')
      setConfirm(null)
      invalidate()
    },
    onError: onErr,
  })

  const deleteReleaseMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiFetchWithReason(
        `/webadmin/launcher-releases/${id}`,
        { method: 'DELETE' },
        note
      ),
    onSuccess: () => {
      toast.success('Release deleted')
      setConfirm(null)
      setSelectedId(null)
      invalidate()
    },
    onError: onErr,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const busy = deletePlatformMut.isPending || deleteReleaseMut.isPending

  let confirmCard = null
  if (confirm?.kind === 'release') {
    const { release } = confirm
    const rest = releases.filter((r) => r.id !== release.id)
    const nextLatest = release.id === releases[0]?.id ? rest[0] : null
    const missing = PLATFORMS.filter(
      (p) =>
        !rest.some((r) => r.assets.some((a) => a.platform === p)) &&
        release.assets.some((a) => a.platform === p)
    )
    confirmCard = (
      <ConfirmCard
        key={`release-${release.id}`}
        title={`Delete release ${release.version}?`}
        rows={[
          {
            label: `Version ${release.version}`,
            value: (
              <>
                <s className='text-muted-foreground'>
                  {release.assets.length} platform files
                </s>{' '}
                to none advertised
              </>
            ),
          },
          ...(nextLatest
            ? [
                {
                  label: 'Latest',
                  value: (
                    <>
                      <s className='text-muted-foreground'>{release.version}</s>{' '}
                      to {nextLatest.version}
                    </>
                  ),
                },
              ]
            : []),
          ...(missing.length > 0
            ? [
                {
                  label: 'Players',
                  value: `No ${missing.map((p) => PLATFORM_LABELS[p]).join(', ')} download until a release with that file is imported`,
                },
              ]
            : []),
          {
            label: 'GitHub',
            value: 'The GitHub release is untouched',
          },
        ]}
        presets={['Broken build', 'Wrong files imported']}
        placeholder='Why delete this release?'
        confirmLabel={`Delete release ${release.version}`}
        pending={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={(note) => deleteReleaseMut.mutate({ id: release.id, note })}
      />
    )
  } else if (confirm?.kind === 'file') {
    const { release, platform } = confirm
    const asset = release.assets.find((a) => a.platform === platform)
    confirmCard = (
      <ConfirmCard
        key={`file-${release.id}-${platform}`}
        title={`Remove the ${PLATFORM_LABELS[platform]} file?`}
        rows={[
          {
            label: `Version ${release.version}`,
            value: (
              <>
                <s className='font-mono text-muted-foreground'>
                  {asset?.originalFilename}
                </s>{' '}
                to not advertised
              </>
            ),
          },
          {
            label: 'Players',
            value: `${PLATFORM_LABELS[platform]} players cannot download this version`,
          },
          { label: 'Other files', value: 'The other platform files stay' },
        ]}
        presets={['Broken build', 'Wrong file imported']}
        placeholder='Why remove this file?'
        confirmLabel={`Remove ${PLATFORM_LABELS[platform]} file`}
        pending={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={(note) =>
          deletePlatformMut.mutate({ release, platform, note })
        }
      />
    )
  }

  return (
    <div className='container max-w-6xl space-y-6 py-8'>
      <div className='text-muted-foreground text-sm'>
        Staff / Ops / <span className='text-primary'>BET Releases</span>
      </div>
      <div className='flex flex-wrap items-baseline gap-x-4'>
        <h1 className='font-pixel text-4xl'>BET Releases</h1>
        <p className='text-muted-foreground text-sm'>
          Served at <code className='font-mono'>/api/launcher/latest</code> and{' '}
          <code className='font-mono'>
            /api/launcher/download/:version/:platform
          </code>
          . Only file data is stored here.
        </p>
      </div>

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]'>
        <div className='space-y-6'>
          <LauncherReleasesTable
            releases={releases}
            isLoading={releasesQ.isLoading}
            selectedId={selected?.id ?? null}
            pendingReleaseId={pendingReleaseId}
            onSelect={(r) => setSelectedId(r.id)}
            onResync={(release) => resyncMut.mutate(release)}
          />
          <AddReleaseForm
            githubReleases={githubReleases}
            isLoadingGithubReleases={githubReleasesQ.isLoading}
            isPending={importMut.isPending}
            onSubmit={(tag) => importMut.mutate(tag)}
          />
        </div>
        <div className='space-y-6'>
          <ReleaseDetailCard
            release={selected}
            busy={busy}
            onRemove={(release, platform) =>
              setConfirm({ kind: 'file', release, platform })
            }
            onResync={(release) => resyncMut.mutate(release)}
            onDelete={(release) => setConfirm({ kind: 'release', release })}
          />
          {confirmCard}
        </div>
      </div>
    </div>
  )
}
