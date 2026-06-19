'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useState } from 'react'
import { toast } from 'sonner'
import { TableShell } from '@/app/_components/table-shell'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { api } from '@/trpc/react'

export type SeasonListRow = {
  id: number
  name: string
  startDate: string
  endDate: string | null
  isActive: boolean
  snapshotCount: number
}

type FormErrors = {
  name?: string
  startDate?: string
}

const initialErrors: FormErrors = {}

export function SeasonsClient({ seasons }: { seasons: SeasonListRow[] }) {
  const router = useRouter()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [errors, setErrors] = useState<FormErrors>(initialErrors)

  const createSeason = api.seasons.create.useMutation({
    onSuccess: () => {
      setIsCreateOpen(false)
      setName('')
      setStartDate('')
      setErrors(initialErrors)
      toast.success('Season created')
      startTransition(() => {
        router.refresh()
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  function handleDialogChange(open: boolean) {
    setIsCreateOpen(open)

    if (!open) {
      setName('')
      setStartDate('')
      setErrors(initialErrors)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors: FormErrors = {}

    if (!name.trim()) {
      nextErrors.name = 'Name required'
    }

    if (!startDate) {
      nextErrors.startDate = 'Start date required'
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    createSeason.mutate({
      name: name.trim(),
      startDate: new Date(startDate),
      isActive: false,
    })
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <p className='text-muted-foreground text-sm'>
          {seasons.length} season{seasons.length === 1 ? '' : 's'}
        </p>

        <Button onClick={() => setIsCreateOpen(true)}>New Season</Button>
      </div>

      <TableShell className='overflow-hidden'>
        <Table>
          <TableHeader className='bg-muted/50'>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Snapshots</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {seasons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className='text-muted-foreground'>
                  No seasons yet
                </TableCell>
              </TableRow>
            ) : (
              seasons.map((season) => (
                <TableRow key={season.id}>
                  <TableCell>{season.id}</TableCell>
                  <TableCell className='font-medium'>{season.name}</TableCell>
                  <TableCell>{formatDate(season.startDate)}</TableCell>
                  <TableCell>
                    {season.isActive && !season.endDate
                      ? 'Active'
                      : season.endDate
                        ? formatDate(season.endDate)
                        : '—'}
                  </TableCell>
                  <TableCell>
                    {season.isActive ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant='outline'>Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>{season.snapshotCount}</TableCell>
                  <TableCell>
                    <div className='flex'>
                      <Button variant='outline' size='sm' asChild>
                        <Link href={`/admin/seasons/${season.id}`}>Manage</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableShell>

      <Dialog open={isCreateOpen} onOpenChange={handleDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Season</DialogTitle>
            <DialogDescription>
              Create a season, then manage queues and snapshots from its detail
              page.
            </DialogDescription>
          </DialogHeader>

          <form className='flex flex-col gap-4' onSubmit={handleSubmit}>
            <div className='grid gap-2'>
              <Label htmlFor='season-name'>Name</Label>
              <Input
                id='season-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder='Season 7'
                disabled={createSeason.isPending}
              />
              {errors.name ? (
                <p className='text-destructive text-sm'>{errors.name}</p>
              ) : null}
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='season-start-date'>Start date</Label>
              <Input
                id='season-start-date'
                type='date'
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                disabled={createSeason.isPending}
              />
              {errors.startDate ? (
                <p className='text-destructive text-sm'>{errors.startDate}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => handleDialogChange(false)}
                disabled={createSeason.isPending}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={createSeason.isPending}>
                {createSeason.isPending ? 'Creating...' : 'Create Season'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
