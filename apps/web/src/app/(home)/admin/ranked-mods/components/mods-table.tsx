import { Button } from '@/components/ui/button'
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
import type { ModSummary } from './ranked-mods-types'

export function ModsTable({
  mods,
  isAdmin,
  pendingModId,
  onToggle,
  onSetRankedVersion,
  onClearRanked,
  onEdit,
  onDelete,
}: {
  mods: ModSummary[]
  isAdmin: boolean
  pendingModId: string | null
  onToggle: (mod: ModSummary, allowed: boolean) => void
  onSetRankedVersion: (mod: ModSummary, version: string | null) => void
  onClearRanked: (modId: string) => void
  onEdit: (mod: ModSummary) => void
  onDelete: (modId: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mod</TableHead>
          <TableHead>Latest version</TableHead>
          <TableHead>Allowed in ranked</TableHead>
          <TableHead>Ranked version</TableHead>
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
              </p>
              <p className='font-mono text-muted-foreground text-xs'>
                {mod.id}
              </p>
            </TableCell>
            <TableCell>{mod.latestVersion ?? '—'}</TableCell>
            <TableCell>
              <Switch
                checked={mod.allowedInRanked}
                disabled={!isAdmin || pendingModId === mod.id}
                onCheckedChange={(checked) => onToggle(mod, checked)}
              />
            </TableCell>
            <TableCell>
              <Input
                key={`${mod.id}:${mod.rankedVersion ?? ''}`}
                className='h-8 w-32 font-mono text-xs'
                placeholder='Any version'
                defaultValue={mod.rankedVersion ?? ''}
                disabled={
                  !isAdmin || !mod.allowedInRanked || pendingModId === mod.id
                }
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  if (value === (mod.rankedVersion ?? '')) return
                  onSetRankedVersion(mod, value || null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </TableCell>
            <TableCell className='space-x-1'>
              {isAdmin && (mod.allowedInRanked || mod.rankedVersion) && (
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={pendingModId === mod.id}
                  onClick={() => onClearRanked(mod.id)}
                >
                  Clear
                </Button>
              )}
              {isAdmin && mod.isCustom && (
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
              colSpan={5}
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
