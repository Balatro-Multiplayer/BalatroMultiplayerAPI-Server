'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/api'
import type {
  ModPatch,
  ModSummary,
  ModVersion,
  VersionSource,
} from './ranked-mods-types'

// Radix Select items can't have an empty string value -- this sentinel
// stands in for "not ranked" (rankedVersion: null) on the wire in/out of
// the dropdown only, never sent to the API itself.
const NONE_VALUE = '__none__'

const SOURCE_LABEL: Record<VersionSource, string> = {
  thunderstore: 'Thunderstore',
  github: 'GitHub',
}

// The pinned download under the version picker: where it comes from, a link
// to the exact archive that was hashed, and the sync's health flag.
function PinDetails({ mod }: { mod: ModSummary }) {
  if (!mod.rankedVersion) return null
  if (!mod.rankedDownloadUrl) {
    return (
      <p className='mt-1 text-muted-foreground text-xs'>
        Resolving on next sync…
      </p>
    )
  }
  return (
    <p className='mt-1 flex items-center gap-1.5 text-muted-foreground text-xs'>
      {mod.rankedSource && SOURCE_LABEL[mod.rankedSource]}
      <a
        href={mod.rankedDownloadUrl}
        className='underline underline-offset-2'
        target='_blank'
        rel='noreferrer'
      >
        download
      </a>
      {mod.rankedDownloadStatus === 'unavailable' && (
        <Badge variant='destructive'>Unavailable — re-pin</Badge>
      )}
    </p>
  )
}

// Options are fetched lazily (only once this row's dropdown is actually
// opened) via GET /webadmin/mods/:id/versions, which returns the mod's merged
// version list -- Thunderstore versions first, then GitHub-only ones -- so
// any of them can be pinned. Avoids fetching every mod's versions up front
// for a table where most rows will never be touched.
function RankedVersionSelect({
  mod,
  disabled,
  onChange,
}: {
  mod: ModSummary
  disabled: boolean
  onChange: (version: string | null) => void
}) {
  const [open, setOpen] = useState(false)

  const { data: versions, isLoading } = useQuery<ModVersion[]>({
    queryKey: ['mod-versions', mod.id],
    queryFn: () =>
      apiFetch(`/webadmin/mods/${encodeURIComponent(mod.id)}/versions`),
    enabled: open,
  })

  // Before the dropdown has ever been opened (or while its fetch is in
  // flight), fall back to just the currently-selected version (if any) so
  // the trigger has a matching SelectItem to render a label from instead of
  // going blank.
  const options: Pick<ModVersion, 'version' | 'source' | 'aliases'>[] =
    versions ??
    (mod.rankedVersion
      ? [
          {
            version: mod.rankedVersion,
            source: mod.rankedSource ?? 'thunderstore',
            aliases: [],
          },
        ]
      : [])

  return (
    <Select
      value={mod.rankedVersion ?? NONE_VALUE}
      disabled={disabled}
      onOpenChange={setOpen}
      onValueChange={(value) => onChange(value === NONE_VALUE ? null : value)}
    >
      <SelectTrigger size='sm' className='h-8 w-44 font-mono text-xs'>
        <SelectValue placeholder='None' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None</SelectItem>
        {isLoading && !versions && (
          <div className='px-2 py-1.5 text-muted-foreground text-xs'>
            Loading versions…
          </div>
        )}
        {options.map((v) => (
          <SelectItem key={v.version} value={v.version}>
            <span className='font-mono'>{v.version}</span>
            <span className='text-muted-foreground text-xs'>
              {SOURCE_LABEL[v.source]}
              {v.aliases.length > 0 && ` · also ${v.aliases.join(', ')}`}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ModsTable({
  mods,
  isAdmin,
  pendingModId,
  onUpdate,
  onEdit,
  onDelete,
  onPinCommit,
}: {
  mods: ModSummary[]
  isAdmin: boolean
  pendingModId: string | null
  onUpdate: (mod: ModSummary, patch: ModPatch) => void
  onEdit: (mod: ModSummary) => void
  onDelete: (mod: ModSummary) => void
  onPinCommit: (mod: ModSummary) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mod</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Ranked version</TableHead>
          <TableHead>Featured</TableHead>
          <TableHead>Hidden</TableHead>
          <TableHead>Track GitHub</TableHead>
          {isAdmin && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {mods.map((mod) => {
          const disabled = !isAdmin || pendingModId === mod.id
          return (
            <TableRow key={mod.id}>
              <TableCell>
                <p className='font-medium'>
                  {mod.title}
                  {mod.isCustom && (
                    <Badge variant='secondary' className='ml-2'>
                      Custom · {mod.sourceType}
                    </Badge>
                  )}
                </p>
                <p className='font-mono text-muted-foreground text-xs'>
                  {mod.id}
                  {mod.thunderstoreFullName &&
                    mod.thunderstoreFullName !== mod.id &&
                    ` · ${mod.thunderstoreFullName}`}
                </p>
              </TableCell>
              <TableCell>{mod.author}</TableCell>
              <TableCell>
                <RankedVersionSelect
                  mod={mod}
                  disabled={disabled}
                  onChange={(version) =>
                    onUpdate(mod, { rankedVersion: version })
                  }
                />
                <PinDetails mod={mod} />
              </TableCell>
              <TableCell>
                <Switch
                  checked={mod.featured}
                  disabled={disabled}
                  onCheckedChange={(featured) => onUpdate(mod, { featured })}
                />
              </TableCell>
              <TableCell>
                <Switch
                  checked={mod.hidden}
                  disabled={disabled}
                  onCheckedChange={(hidden) => onUpdate(mod, { hidden })}
                />
              </TableCell>
              <TableCell>
                <Switch
                  checked={mod.trackGithub}
                  disabled={disabled || mod.isCustom}
                  title={
                    mod.isCustom
                      ? 'Custom mods always list their GitHub versions'
                      : 'Also list GitHub releases/tags as versions (next sync)'
                  }
                  onCheckedChange={(trackGithub) =>
                    onUpdate(mod, { trackGithub })
                  }
                />
              </TableCell>
              {isAdmin && (
                <TableCell className='whitespace-nowrap text-right'>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={pendingModId === mod.id}
                    onClick={() => onPinCommit(mod)}
                  >
                    Pin commit
                  </Button>
                  {mod.isCustom && (
                    <>
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={pendingModId === mod.id}
                        onClick={() => onEdit(mod)}
                      >
                        Edit
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-destructive'
                        disabled={pendingModId === mod.id}
                        onClick={() => onDelete(mod)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </TableCell>
              )}
            </TableRow>
          )
        })}
        {mods.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={7}
              className='text-center text-muted-foreground'
            >
              No mods synced yet — MOD_INDEX_SYNC_ENABLED may not be set, or the
              hourly sync hasn't run.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
