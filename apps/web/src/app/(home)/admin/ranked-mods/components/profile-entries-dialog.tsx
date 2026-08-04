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
import type { ModProfileDetail, ModSummary } from './ranked-mods-types'

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
    versionConstraint: string,
    allowed: boolean
  ) => void
  onRemoveEntry: (modId: string) => void
  onClose: () => void
}) {
  const [modId, setModId] = useState('')
  const [versionConstraint, setVersionConstraint] = useState('any')
  const [allowed, setAllowed] = useState(true)

  const modName = (id: string) => mods.find((m) => m.id === id)?.name ?? id

  return (
    <Dialog
      open={profile !== null}
      onOpenChange={(o) => {
        if (!o) {
          setModId('')
          setVersionConstraint('any')
          setAllowed(true)
          onClose()
        }
      }}
    >
      <DialogContent className='sm:max-w-[600px]'>
        <DialogHeader>
          <DialogTitle>{profile?.name} — mods</DialogTitle>
          <DialogDescription>
            versionConstraint accepts "any", an exact version string, or
            "min:&lt;version&gt;".
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
                  {entry.versionConstraint}
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
          <Input
            className='w-32'
            placeholder='any'
            value={versionConstraint}
            onChange={(e) => setVersionConstraint(e.target.value)}
          />
          <div className='flex items-center gap-2 pb-2'>
            <Switch checked={allowed} onCheckedChange={setAllowed} />
          </div>
          <Button
            disabled={!modId || isPending}
            onClick={() => {
              onUpsertEntry(modId, versionConstraint || 'any', allowed)
              setModId('')
              setVersionConstraint('any')
              setAllowed(true)
            }}
          >
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
