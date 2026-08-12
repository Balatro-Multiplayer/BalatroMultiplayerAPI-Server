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
import {
  formatFileSize,
  PLATFORM_ACCEPT,
  PLATFORM_LABELS,
  PLATFORMS,
} from './launcher-releases-types'

function PlatformCell({
  release,
  platform,
  isPending,
  onUpload,
  onDelete,
}: {
  release: LauncherRelease
  platform: LauncherPlatform
  isPending: boolean
  onUpload: (
    release: LauncherRelease,
    platform: LauncherPlatform,
    file: File
  ) => void
  onDelete: (release: LauncherRelease, platform: LauncherPlatform) => void
}) {
  const asset = release.assets.find((a) => a.platform === platform)

  return (
    <div className='flex items-center gap-2'>
      {asset ? (
        <>
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
        </>
      ) : (
        <Badge variant='outline' className='text-muted-foreground'>
          Not uploaded
        </Badge>
      )}
      <label className='shrink-0 cursor-pointer text-blue-500 text-xs hover:underline'>
        {asset ? 'Replace' : 'Upload'}
        <input
          type='file'
          accept={PLATFORM_ACCEPT[platform]}
          className='hidden'
          disabled={isPending}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(release, platform, file)
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}

export function LauncherReleasesTable({
  releases,
  isLoading,
  pendingReleaseId,
  onUpload,
  onDeletePlatform,
  onDeleteRelease,
}: {
  releases: LauncherRelease[]
  isLoading: boolean
  pendingReleaseId: number | null
  onUpload: (
    release: LauncherRelease,
    platform: LauncherPlatform,
    file: File
  ) => void
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
              No launcher releases uploaded yet.
            </TableCell>
          </TableRow>
        )}
        {releases.map((release) => {
          const isPending = pendingReleaseId === release.id
          return (
            <TableRow key={release.id}>
              <TableCell>
                <p className='font-medium font-mono'>{release.version}</p>
                {release.notes && (
                  <p className='max-w-xs truncate text-muted-foreground text-xs'>
                    {release.notes}
                  </p>
                )}
              </TableCell>
              {PLATFORMS.map((platform) => (
                <TableCell key={platform}>
                  <PlatformCell
                    release={release}
                    platform={platform}
                    isPending={isPending}
                    onUpload={onUpload}
                    onDelete={onDeletePlatform}
                  />
                </TableCell>
              ))}
              <TableCell>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive hover:text-destructive'
                  disabled={isPending}
                  onClick={() => onDeleteRelease(release)}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
