import { Button } from '@/components/ui/button'
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
  onResetOverride,
}: {
  mods: ModSummary[]
  isAdmin: boolean
  pendingModId: string | null
  onToggle: (mod: ModSummary, allowed: boolean) => void
  onResetOverride: (modId: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mod</TableHead>
          <TableHead>Latest version</TableHead>
          <TableHead>Allowed in ranked</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {mods.map((mod) => (
          <TableRow key={mod.id}>
            <TableCell>
              <p className='font-medium'>{mod.name}</p>
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
              {isAdmin && (
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={pendingModId === mod.id}
                  onClick={() => onResetOverride(mod.id)}
                >
                  Reset to index
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
        {mods.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={4}
              className='text-center text-muted-foreground'
            >
              No mods synced yet — BET_MOD_INDEX_URL may not be configured, or
              the hourly sync hasn't run.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
