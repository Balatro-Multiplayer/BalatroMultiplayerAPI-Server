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

interface Season {
  id: number
  name: string
  startedAt: string
  endsAt: string | null
  endedAt: string | null
  active: boolean
}

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleDateString() : '-'
}

export function SeasonsTable({
  seasons,
  isLoading,
  activatePending,
  endPending,
  onActivate,
  onEnd,
}: {
  seasons: Season[]
  isLoading: boolean
  activatePending: boolean
  endPending: boolean
  onActivate: (id: number) => void
  onEnd: (id: number) => void
}) {
  return (
    <div className='overflow-hidden rounded-lg border border-border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Ends</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className='text-right'>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className='text-muted-foreground'>
                Loading…
              </TableCell>
            </TableRow>
          ) : seasons.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className='text-muted-foreground'>
                No seasons yet
              </TableCell>
            </TableRow>
          ) : (
            seasons.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.id}</TableCell>
                <TableCell className='font-medium'>{s.name}</TableCell>
                <TableCell>{fmt(s.startedAt)}</TableCell>
                <TableCell>{fmt(s.endsAt)}</TableCell>
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
                      onClick={() => onEnd(s.id)}
                      disabled={endPending}
                    >
                      End
                    </Button>
                  ) : (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => onActivate(s.id)}
                      disabled={activatePending}
                    >
                      Activate
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
