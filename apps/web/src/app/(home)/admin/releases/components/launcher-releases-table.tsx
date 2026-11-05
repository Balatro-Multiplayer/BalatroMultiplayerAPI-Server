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
import { cn } from '@/lib/utils'
import type { LauncherRelease } from './launcher-releases-types'
import {
  formatFileSize,
  PLATFORM_LABELS,
  PLATFORMS,
} from './launcher-releases-types'

export function LauncherReleasesTable({
  releases,
  isLoading,
  selectedId,
  pendingReleaseId,
  onSelect,
  onResync,
}: {
  releases: LauncherRelease[]
  isLoading: boolean
  selectedId: number | null
  pendingReleaseId: number | null
  onSelect: (release: LauncherRelease) => void
  onResync: (release: LauncherRelease) => void
}) {
  return (
    <section className='rounded-xl border border-border bg-card p-4'>
      <div className='mb-2 flex items-baseline justify-between'>
        <h2 className='font-pixel text-lg'>Imported releases</h2>
        <span className='text-muted-foreground text-sm'>
          {releases.length} versions
        </span>
      </div>
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
          {releases.map((release, i) => {
            const isPending = pendingReleaseId === release.id
            return (
              <TableRow
                key={release.id}
                className={cn(
                  'cursor-pointer',
                  selectedId === release.id && 'bg-destructive/10'
                )}
                onClick={() => onSelect(release)}
              >
                <TableCell>
                  <p className='font-medium font-mono'>{release.version}</p>
                  <p className='font-mono text-muted-foreground text-xs'>
                    {release.githubReleaseTag}
                  </p>
                  {i === 0 && (
                    <Badge variant='outline' className='mt-1'>
                      latest
                    </Badge>
                  )}
                </TableCell>
                {PLATFORMS.map((platform) => {
                  const asset = release.assets.find(
                    (a) => a.platform === platform
                  )
                  return (
                    <TableCell key={platform}>
                      {asset ? (
                        <>
                          <p
                            className='max-w-48 truncate text-sm'
                            title={asset.originalFilename}
                          >
                            {asset.originalFilename}
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            {formatFileSize(asset.fileSize)}
                          </p>
                        </>
                      ) : (
                        <Badge
                          variant='outline'
                          className='text-muted-foreground'
                        >
                          Not in this release
                        </Badge>
                      )}
                    </TableCell>
                  )
                })}
                <TableCell className='text-right'>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={isPending}
                    onClick={(e) => {
                      e.stopPropagation()
                      onResync(release)
                    }}
                  >
                    Re-sync
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}
