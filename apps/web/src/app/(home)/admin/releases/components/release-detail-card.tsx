'use client'

import { Button } from '@/components/ui/button'
import type {
  LauncherPlatform,
  LauncherRelease,
} from './launcher-releases-types'
import {
  formatFileSize,
  PLATFORM_LABELS,
  PLATFORMS,
} from './launcher-releases-types'

export function ReleaseDetailCard({
  release,
  busy,
  onRemove,
  onResync,
  onDelete,
}: {
  release: LauncherRelease | undefined
  busy: boolean
  onRemove: (release: LauncherRelease, platform: LauncherPlatform) => void
  onResync: (release: LauncherRelease) => void
  onDelete: (release: LauncherRelease) => void
}) {
  if (!release) {
    return (
      <section className='rounded-xl border border-border bg-card p-4 text-muted-foreground text-sm'>
        Select a release to see its files.
      </section>
    )
  }
  return (
    <section className='space-y-3 rounded-xl border border-border bg-card p-4'>
      <div className='flex items-baseline justify-between'>
        <h2 className='font-mono font-semibold text-lg'>{release.version}</h2>
        <span className='text-muted-foreground text-xs'>
          imported {new Date(release.createdAt).toLocaleDateString()}, synced{' '}
          {new Date(release.updatedAt).toLocaleDateString()}
        </span>
      </div>
      {release.notes && (
        <p className='whitespace-pre-wrap text-muted-foreground text-sm'>
          {release.notes}
        </p>
      )}
      <ul className='divide-y divide-border text-sm'>
        {PLATFORMS.map((platform) => {
          const asset = release.assets.find((a) => a.platform === platform)
          return (
            <li key={platform} className='flex items-center gap-3 py-2'>
              <span className='w-16 text-muted-foreground'>
                {PLATFORM_LABELS[platform]}
              </span>
              {asset ? (
                <>
                  <div className='min-w-0 flex-1'>
                    <p
                      className='truncate font-mono text-xs'
                      title={asset.originalFilename}
                    >
                      {asset.originalFilename}
                    </p>
                    <p className='truncate font-mono text-muted-foreground text-xs'>
                      {formatFileSize(asset.fileSize)}, sha256{' '}
                      {asset.sha256.slice(0, 8)}...{asset.sha256.slice(-4)}
                    </p>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    className='border-destructive/60 text-destructive'
                    disabled={busy}
                    onClick={() => onRemove(release, platform)}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <span className='text-muted-foreground'>
                  Not in this release
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div className='flex justify-between'>
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          onClick={() => onResync(release)}
        >
          Re-sync from GitHub
        </Button>
        <Button
          variant='outline'
          size='sm'
          className='border-destructive/60 text-destructive'
          disabled={busy}
          onClick={() => onDelete(release)}
        >
          Delete release…
        </Button>
      </div>
    </section>
  )
}
