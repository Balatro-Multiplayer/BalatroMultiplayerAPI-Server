import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
import type {
  ModProfileDetail,
  ModProfileVersionMode,
  ModSummary,
} from './ranked-mods-types'

const VERSION_MODE_LABELS: Record<ModProfileVersionMode, string> = {
  exact: 'Exact version',
  latest: 'Latest',
  latestRanked: 'Latest ranked',
}

export function ProfileEntriesDialog({
  profile,
  mods,
  isPending,
  onUpsertEntry,
  onRemoveEntry,
  onClose,
}: {
  profile: ModProfileDetail | null
  mods: ModSummary[]
  isPending: boolean
  onUpsertEntry: (
    modId: string,
    versionMode: ModProfileVersionMode,
    pinnedVersion: string | null,
    allowed: boolean
  ) => void
  onRemoveEntry: (modId: string) => void
  onClose: () => void
}) {
  const [modId, setModId] = useState('')
  const [versionMode, setVersionMode] =
    useState<ModProfileVersionMode>('latest')
  const [pinnedVersion, setPinnedVersion] = useState('')
  const [allowed, setAllowed] = useState(true)

  const modName = (id: string) => mods.find((m) => m.id === id)?.name ?? id

  const resetForm = () => {
    setModId('')
    setVersionMode('latest')
    setPinnedVersion('')
    setAllowed(true)
  }

  return (
    <Dialog
      open={profile !== null}
      onOpenChange={(o) => {
        if (!o) {
          resetForm()
          onClose()
        }
      }}
    >
      <DialogContent className='sm:max-w-[600px]'>
        <DialogHeader>
          <DialogTitle>{profile?.name} — mods</DialogTitle>
          <DialogDescription>
            Pin each mod to an exact version, always resolve to the newest
            version, or always resolve to whatever's currently marked
            ranked-safe.
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mod</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Allowed</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {profile?.entries.map((entry) => (
              <TableRow key={entry.modId}>
                <TableCell>{modName(entry.modId)}</TableCell>
                <TableCell className='font-mono text-xs'>
                  {entry.versionMode === 'exact'
                    ? entry.pinnedVersion
                    : VERSION_MODE_LABELS[entry.versionMode]}
                </TableCell>
                <TableCell>{entry.allowed ? 'Yes' : 'No'}</TableCell>
                <TableCell>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={isPending}
                    onClick={() => onRemoveEntry(entry.modId)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(profile?.entries.length ?? 0) === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-center text-muted-foreground'
                >
                  No mods in this profile yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className='flex items-end gap-3 border-border border-t pt-4'>
          <div className='flex-1 space-y-2'>
            <Select value={modId} onValueChange={setModId}>
              <SelectTrigger>
                <SelectValue placeholder='Mod' />
              </SelectTrigger>
              <SelectContent>
                {mods.map((mod) => (
                  <SelectItem key={mod.id} value={mod.id}>
                    {mod.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select
            value={versionMode}
            onValueChange={(v) => setVersionMode(v as ModProfileVersionMode)}
          >
            <SelectTrigger className='w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                Object.keys(VERSION_MODE_LABELS) as ModProfileVersionMode[]
              ).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {VERSION_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {versionMode === 'exact' && (
            <Input
              className='w-32'
              placeholder='1.2.3'
              value={pinnedVersion}
              onChange={(e) => setPinnedVersion(e.target.value)}
            />
          )}
          <div className='flex items-center gap-2 pb-2'>
            <Switch checked={allowed} onCheckedChange={setAllowed} />
          </div>
          <Button
            disabled={
              !modId || isPending || (versionMode === 'exact' && !pinnedVersion)
            }
            onClick={() => {
              onUpsertEntry(
                modId,
                versionMode,
                versionMode === 'exact' ? pinnedVersion : null,
                allowed
              )
              resetForm()
            }}
          >
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
