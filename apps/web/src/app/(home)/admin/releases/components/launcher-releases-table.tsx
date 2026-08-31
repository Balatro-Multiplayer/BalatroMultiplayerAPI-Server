'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  LauncherPlatform,
  LauncherRelease,
} from './launcher-releases-types'
import { formatFileSize, PLATFORM_LABELS, PLATFORMS } from './launcher-releases-types'

function PlatformCell({
  release,
  platform,
  isPending,
  onDelete,
}: {
  release: LauncherRelease
  platform: LauncherPlatform
  isPending: boolean
  onDelete: (release: LauncherRelease, platform: LauncherPlatform) => void
}) {
  const asset = release.assets.find((a) => a.platform === platform)
  if (!asset) {
    return (
      <Badge variant='outline' className='text-muted-foreground'>
        Not in this release
      </Badge>
    )
  }

  return (
    <div className='flex items-center gap-2'>
      <div className='min-w-0'>
        <p className='truncate text-xs' title={asset.originalFilename}>
          {asset.originalFilename}
        </p>
        <p className='text-muted-foreground text-xs'>
          {formatFileSize(asset.fileSize)}
        </p>
      </div>
      <Button
        variant='ghost'
        size='sm'
        className='shrink-0 text-destructive hover:text-destructive'
        disabled={isPending}
        onClick={() => onDelete(release, platform)}
      >
        Remove
      </Button>
    </div>
  )
}

export function LauncherReleasesTable({
  releases,
  isLoading,
  pendingReleaseId,
  onResync,
  onDeletePlatform,
  onDeleteRelease,
}: {
  releases: LauncherRelease[]
  isLoading: boolean
  pendingReleaseId: number | null
  onResync: (release: LauncherRelease) => void
  onDeletePlatform: (
    release: LauncherRelease,
    platform: LauncherPlatform
  ) => void
  onDeleteRelease: (release: LauncherRelease) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Version</TableHead>
          {PLATFORMS.map((platform) => (
            <TableHead key={platform}>{PLATFORM_LABELS[platform]}</TableHead>
          ))}
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell
              colSpan={PLATFORMS.length + 2}
              className='text-center text-muted-foreground'
            >
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!isLoading && releases.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={PLATFORMS.length + 2}
              className='text-center text-muted-foreground'
            >
              No launcher releases imported yet.
            </TableCell>
          </TableRow>
        )}
        {releases.map((release) => {
          const isPending = pendingReleaseId === release.id
          return (
            <TableRow key={release.id}>
              <TableCell>
                <p className='font-medium font-mono'>{release.version}</p>
                <p className='text-muted-foreground text-xs'>
                  {release.githubReleaseTag}
                </p>
              </TableCell>
              {PLATFORMS.map((platform) => (
                <TableCell key={platform}>
                  <PlatformCell
                    release={release}
                    platform={platform}
                    isPending={isPending}
                    onDelete={onDeletePlatform}
                  />
                </TableCell>
              ))}
              <TableCell>
                <div className='flex justify-end gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={isPending}
                    onClick={() => onResync(release)}
                  >
                    Re-sync
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-destructive hover:text-destructive'
                    disabled={isPending}
                    onClick={() => onDeleteRelease(release)}
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
