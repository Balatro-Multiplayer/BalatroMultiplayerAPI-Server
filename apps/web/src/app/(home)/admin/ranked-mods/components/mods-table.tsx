'use client'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  type ModFilter,
  MOD_FILTERS,
  filterCounts,
} from '../lib/mods-view'
import type { ModPatch, ModSummary } from './ranked-mods-types'

function VersionCell({ mod }: { mod: ModSummary }) {
  if (!mod.rankedVersion) {
    return <Badge variant='outline'>not pinned</Badge>
  }
  return (
    <div className='text-xs'>
      <p className='font-mono'>{mod.rankedVersion}</p>
      {mod.rankedDownloadStatus === 'unavailable' ? (
        <p className='text-destructive'>Unavailable, pin again</p>
      ) : (
        <p className='text-muted-foreground'>
          {mod.rankedSource === 'github' ? 'GitHub' : 'Thunderstore'}
          {mod.rankedDownloadUrl ? ', ok' : ', resolving'}
        </p>
      )}
    </div>
  )
}

export function ModsTable({
  allMods,
  mods,
  filter,
  search,
  selectedId,
  isAdmin,
  pendingModId,
  onFilter,
  onSearch,
  onSelect,
  onUpdate,
}: {
  allMods: ModSummary[]
  mods: ModSummary[]
  filter: ModFilter
  search: string
  selectedId: string | null
  isAdmin: boolean
  pendingModId: string | null
  onFilter: (filter: ModFilter) => void
  onSearch: (search: string) => void
  onSelect: (mod: ModSummary) => void
  onUpdate: (mod: ModSummary, patch: ModPatch) => void
}) {
  const counts = filterCounts(allMods)
  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        {MOD_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type='button'
            onClick={() => onFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              filter === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {label} <b>{counts[key]}</b>
          </button>
        ))}
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder='Search mods'
          className='ml-auto h-9 w-56'
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mod</TableHead>
            <TableHead>Pinned version</TableHead>
            <TableHead>SMODS ids</TableHead>
            <TableHead>Featured</TableHead>
            <TableHead>Hidden</TableHead>
            <TableHead>Track GitHub</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mods.map((mod) => {
            const disabled = !isAdmin || pendingModId === mod.id
            return (
              <TableRow
                key={mod.id}
                data-state={mod.id === selectedId ? 'selected' : undefined}
                className={cn(
                  'cursor-pointer',
                  mod.id === selectedId && 'bg-destructive/10'
                )}
                onClick={() => onSelect(mod)}
              >
                <TableCell>
                  <p className='font-medium'>{mod.title}</p>
                  <p className='text-muted-foreground text-xs'>
                    {mod.author}
                    {mod.isCustom && (
                      <Badge variant='secondary' className='ml-2'>
                        custom
                      </Badge>
                    )}
                  </p>
                </TableCell>
                <TableCell>
                  <VersionCell mod={mod} />
                </TableCell>
                <TableCell>
                  {mod.rankedVersion ? (
                    mod.smodsIds.length > 0 ? (
                      <div className='flex flex-wrap gap-1'>
                        {mod.smodsIds.map((id) => (
                          <Badge
                            key={id}
                            variant='outline'
                            className='font-mono'
                          >
                            {id}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className='text-muted-foreground text-xs'>
                        none read
                      </span>
                    )
                  ) : null}
                </TableCell>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: keeps a switch click from selecting the row */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={mod.featured}
                    disabled={disabled}
                    onCheckedChange={(featured) => onUpdate(mod, { featured })}
                  />
                </TableCell>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: keeps a switch click from selecting the row */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={mod.hidden}
                    disabled={disabled}
                    onCheckedChange={(hidden) => onUpdate(mod, { hidden })}
                  />
                </TableCell>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: keeps a switch click from selecting the row */}
                <TableCell onClick={(e) => e.stopPropagation()}>
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
              </TableRow>
            )
          })}
          {mods.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className='text-center text-muted-foreground'
              >
                {allMods.length === 0
                  ? "No mods synced yet. MOD_INDEX_SYNC_ENABLED may not be set, or the hourly sync hasn't run."
                  : 'No mods match.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
