import { Trash2 } from 'lucide-react'
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
import type { Branch } from './releases-types'

export function BranchManagementDialog({
  open,
  branches,
  newBranch,
  addPending,
  deletePending,
  onNewBranchChange,
  onAdd,
  onDelete,
  onClose,
}: {
  open: boolean
  branches: Branch[]
  newBranch: string
  addPending: boolean
  deletePending: boolean
  onNewBranchChange: (v: string) => void
  onAdd: () => void
  onDelete: (id: number) => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>Manage Branches</DialogTitle>
          <DialogDescription>Add or remove release channels.</DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='new-branch'>Add branch</Label>
            <div className='flex gap-2'>
              <Input
                id='new-branch'
                value={newBranch}
                onChange={(e) => onNewBranchChange(e.target.value)}
                placeholder='e.g. nightly'
              />
              <Button
                type='button'
                onClick={onAdd}
                disabled={!newBranch.trim() || branches.some((b) => b.name === newBranch.trim()) || addPending}
              >
                Add
              </Button>
            </div>
          </div>
          <div className='space-y-2'>
            <Label>Existing branches</Label>
            <ul className='max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-2'>
              {branches.map((b) => (
                <li key={b.id} className='flex items-center justify-between rounded px-2 py-1 hover:bg-muted'>
                  <span>{b.name}</span>
                  {b.name !== 'main' && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 w-7 p-0 text-destructive'
                      onClick={() => onDelete(b.id)}
                      disabled={deletePending}
                    >
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button type='button' onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
