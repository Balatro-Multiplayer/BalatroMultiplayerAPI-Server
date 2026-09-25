'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/api'
import type { ModSummary, ModVersion } from './ranked-mods-types'

// Radix Select items can't have an empty string value -- this sentinel
// stands in for "not ranked" (rankedVersion: null) on the wire in/out of
// the dropdown only, never sent to the API itself.
const NONE_VALUE = '__none__'

// Options are fetched lazily (only once this row's dropdown is actually
// opened) via GET /webadmin/mods/:id/versions, which live-proxies
// Thunderstore's own version list for this package -- avoids fetching every
// mod's versions up front for a table where most rows will never be touched.
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
  const options =
    versions?.map((v) => v.version) ??
    (mod.rankedVersion ? [mod.rankedVersion] : [])

  return (
    <Select
      value={mod.rankedVersion ?? NONE_VALUE}
      disabled={disabled}
      onOpenChange={setOpen}
      onValueChange={(value) => onChange(value === NONE_VALUE ? null : value)}
    >
      <SelectTrigger size='sm' className='h-8 w-40 font-mono text-xs'>
        <SelectValue placeholder='None' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None</SelectItem>
        {isLoading && !versions && (
          <div className='px-2 py-1.5 text-muted-foreground text-xs'>
            Loading versions…
          </div>
        )}
        {options.map((version) => (
          <SelectItem key={version} value={version}>
            {version}
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
  onSetRankedVersion,
}: {
  mods: ModSummary[]
  isAdmin: boolean
  pendingModId: string | null
  onSetRankedVersion: (mod: ModSummary, version: string | null) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mod</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Ranked version</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mods.map((mod) => (
          <TableRow key={mod.id}>
            <TableCell>
              <p className='font-medium'>{mod.title}</p>
              <p className='font-mono text-muted-foreground text-xs'>
                {mod.id}
              </p>
            </TableCell>
            <TableCell>{mod.author}</TableCell>
            <TableCell>
              <RankedVersionSelect
                mod={mod}
                disabled={!isAdmin || pendingModId === mod.id}
                onChange={(version) => onSetRankedVersion(mod, version)}
              />
            </TableCell>
          </TableRow>
        ))}
        {mods.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={3}
              className='text-center text-muted-foreground'
            >
              No mods synced yet — MOD_INDEX_SYNC_ENABLED may not be set, or
              the hourly sync hasn't run.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
