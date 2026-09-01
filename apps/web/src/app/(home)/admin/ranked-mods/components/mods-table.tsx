'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
import type { ModDetail, ModSummary } from './ranked-mods-types'

// Radix Select items can't have an empty string value -- this sentinel
// stands in for "not ranked" (rankedVersion: null) on the wire in/out of
// the dropdown only, never sent to the API itself.
const NONE_VALUE = '__none__'

// A mod is ranked-allowed iff rankedVersion is non-null (see
// ranked-mods-types.ts's ModSourceType doc comment) -- this dropdown is the
// only way to set it now, replacing the old separate allowed-in-ranked
// Switch + free-text version Input. What it offers depends on sourceType:
//   - 'custom': nothing to offer -- custom-hosted mods can never be ranked.
//   - 'branch': None, or the mod's own current latestVersion -- a branch
//     archive URL always re-resolves to current HEAD, so any older value
//     could never actually be re-fetched.
//   - 'release': None, or any of the mod's known historical versions,
//     fetched lazily (only once this row's dropdown is actually opened) via
//     GET /webadmin/mods/:modId, which already returns the full version
//     history -- avoids fetching every mod's versions up front for a table
//     where most rows will never be touched.
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

  const { data: detail, isLoading } = useQuery<ModDetail>({
    queryKey: ['mod-detail', mod.id],
    queryFn: () => apiFetch(`/webadmin/mods/${encodeURIComponent(mod.id)}`),
    enabled: mod.sourceType === 'release' && open,
  })

  if (mod.sourceType === 'custom') {
    return (
      <span
        className='text-muted-foreground text-xs'
        title="Custom-hosted mods can't be ranked-allowed -- their source can't be reliably re-fetched or verified"
      >
        Not eligible
      </span>
    )
  }

  // Before a release-type dropdown has ever been opened (or while its
  // fetch is in flight), fall back to just the currently-selected version
  // (if any) so the trigger has a matching SelectItem to render a label
  // from instead of going blank.
  const options =
    mod.sourceType === 'branch'
      ? mod.latestVersion
        ? [mod.latestVersion]
        : []
      : (detail?.versions.map((v) => v.version) ??
        (mod.rankedVersion ? [mod.rankedVersion] : []))

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
        {mod.sourceType === 'release' && isLoading && !detail && (
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
  emptyMessage,
  onSetRankedVersion,
  onSetFeatured,
  onSetHidden,
  onEdit,
  onDelete,
}: {
  mods: ModSummary[]
  isAdmin: boolean
  pendingModId: string | null
  // Distinguishes "no mods synced at all" from "a search filtered every mod
  // out" - both render as an empty `mods` array, but mean very different
  // things to an admin looking at a blank table (see page.tsx's
  // filteredMods). Defaults to the original "nothing synced" message so
  // every other/future caller doesn't need to pass one.
  emptyMessage?: string
  onSetRankedVersion: (mod: ModSummary, version: string | null) => void
  onSetFeatured: (mod: ModSummary, featured: boolean) => void
  onSetHidden: (mod: ModSummary, hidden: boolean) => void
  onEdit: (mod: ModSummary) => void
  onDelete: (modId: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mod</TableHead>
          <TableHead>Latest version</TableHead>
          <TableHead>Ranked version</TableHead>
          <TableHead>Featured</TableHead>
          <TableHead>Hidden</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {mods.map((mod) => (
          <TableRow key={mod.id}>
            <TableCell>
              <p className='font-medium'>
                {mod.name}
                {mod.isCustom && (
                  <span className='ml-2 text-muted-foreground text-xs'>
                    (custom)
                  </span>
                )}
                {mod.overriddenFields.length > 0 && (
                  <span className='ml-2 text-amber-600 text-xs dark:text-amber-400'>
                    ({mod.overriddenFields.length} field
                    {mod.overriddenFields.length === 1 ? '' : 's'} pinned)
                  </span>
                )}
              </p>
              <p className='font-mono text-muted-foreground text-xs'>
                {mod.id}
              </p>
            </TableCell>
            <TableCell>{mod.latestVersion ?? '—'}</TableCell>
            <TableCell>
              <RankedVersionSelect
                mod={mod}
                disabled={!isAdmin || pendingModId === mod.id}
                onChange={(version) => onSetRankedVersion(mod, version)}
              />
            </TableCell>
            <TableCell>
              <Switch
                checked={mod.featured}
                disabled={!isAdmin || pendingModId === mod.id}
                onCheckedChange={(checked) => onSetFeatured(mod, checked)}
              />
            </TableCell>
            <TableCell>
              <Switch
                checked={mod.hidden}
                disabled={!isAdmin || pendingModId === mod.id}
                onCheckedChange={(checked) => onSetHidden(mod, checked)}
              />
            </TableCell>
            <TableCell className='space-x-1'>
              {isAdmin && (
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={pendingModId === mod.id}
                  onClick={() => onEdit(mod)}
                >
                  Edit
                </Button>
              )}
              {isAdmin && mod.isCustom && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive hover:text-destructive'
                  disabled={pendingModId === mod.id}
                  onClick={() => onDelete(mod.id)}
                >
                  Delete
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
        {mods.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={6}
              className='text-center text-muted-foreground'
            >
              {emptyMessage ??
                "No mods synced yet — MOD_INDEX_SYNC_ENABLED may not be set, or the hourly sync hasn't run."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
