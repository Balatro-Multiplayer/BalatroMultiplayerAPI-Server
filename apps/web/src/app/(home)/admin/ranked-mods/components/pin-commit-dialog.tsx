import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ModSummary } from './ranked-mods-types'

const SHA = /^[0-9a-f]{7,40}$/i

// Pins a specific GitHub commit: the server records it as a GitHub version
// (short SHA), resolves it to a permanent codeload commit archive, and
// hashes it -- see PUT /webadmin/mods/:id's rankedCommit.
export function PinCommitDialog({
  target,
  isPending,
  onConfirm,
  onClose,
}: {
  target: ModSummary | null
  isPending: boolean
  onConfirm: (sha: string) => void
  onClose: () => void
}) {
  const [sha, setSha] = useState('')
  useEffect(() => {
    if (target) setSha('')
  }, [target])

  const valid = SHA.test(sha.trim())

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>Pin a commit</DialogTitle>
          <DialogDescription>
            Pins {target && <strong>{target.title}</strong>} to one exact commit
            from its GitHub repo. The download never changes after pinning.
          </DialogDescription>
        </DialogHeader>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) onConfirm(sha.trim())
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='pin-commit-sha'>Commit SHA</Label>
            <Input
              id='pin-commit-sha'
              className='font-mono'
              value={sha}
              placeholder='e.g. 3e96386'
              onChange={(e) => setSha(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={!valid || isPending}>
              {isPending ? 'Pinning…' : 'Pin commit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
