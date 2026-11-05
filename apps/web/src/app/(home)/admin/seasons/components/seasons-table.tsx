import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatDay, type Season } from './seasons-types'

export function SeasonsTable({
  seasons,
  isLoading,
  busy,
  onEnd,
  onActivate,
}: {
  seasons: Season[]
  isLoading: boolean
  busy: boolean
  onEnd: (season: Season) => void
  onActivate: (season: Season) => void
}) {
  // Newest first.
  const rows = [...seasons].sort((a, b) => b.id - a.id)
  return (
    <section className='rounded-xl border border-border bg-card p-4'>
      <h2 className='mb-2 font-pixel text-lg'>All seasons</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Id</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Ends</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className='text-muted-foreground'>
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className='text-muted-foreground'>
                No seasons yet
              </TableCell>
            </TableRow>
          ) : (
            rows.map((s) => (
              <TableRow
                key={s.id}
                className={cn(s.active && 'bg-destructive/10')}
              >
                <TableCell className='font-mono'>{s.id}</TableCell>
                <TableCell className='font-medium'>{s.name}</TableCell>
                <TableCell>{formatDay(s.startedAt)}</TableCell>
                <TableCell>{formatDay(s.endsAt)}</TableCell>
                <TableCell>
                  {s.active ? (
                    <Badge>Active</Badge>
                  ) : (
                    <Badge variant='outline'>Ended</Badge>
                  )}
                </TableCell>
                <TableCell className='text-right'>
                  {s.active ? (
                    <Button
                      variant='outline'
                      size='sm'
                      className='border-destructive/60 text-destructive'
                      onClick={() => onEnd(s)}
                      disabled={busy}
                    >
                      End…
                    </Button>
                  ) : (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => onActivate(s)}
                      disabled={busy}
                    >
                      Activate…
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  )
}
