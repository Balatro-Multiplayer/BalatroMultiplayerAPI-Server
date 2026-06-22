import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Release } from './releases-types'

export function ReleasesTable({
  releases,
  isLoading,
  onEdit,
  onDelete,
}: {
  releases: Release[]
  isLoading: boolean
  onEdit: (r: Release) => void
  onDelete: (r: Release) => void
}) {
  return (
    <div className='overflow-x-auto rounded-lg border border-border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>SMODS</TableHead>
            <TableHead>Lovely</TableHead>
            <TableHead className='text-right'>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className='text-muted-foreground'>Loading…</TableCell>
            </TableRow>
          ) : releases.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className='text-muted-foreground'>No releases</TableCell>
            </TableRow>
          ) : (
            releases.map((r) => (
              <TableRow key={r.id}>
                <TableCell className='font-medium'>{r.name}</TableCell>
                <TableCell>{r.version}</TableCell>
                <TableCell>{r.branchName ?? 'main'}</TableCell>
                <TableCell className='max-w-[220px]'>
                  <a
                    href={r.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='block truncate text-bal-blue hover:underline'
                    title={r.url}
                  >
                    {r.url}
                  </a>
                </TableCell>
                <TableCell>{r.smods_version ?? 'latest'}</TableCell>
                <TableCell>{r.lovely_version ?? 'latest'}</TableCell>
                <TableCell className='space-x-2 text-right'>
                  <Button variant='outline' size='sm' onClick={() => onEdit(r)}>
                    <Pencil className='mr-1 h-4 w-4' /> Edit
                  </Button>
                  <Button variant='destructive' size='sm' onClick={() => onDelete(r)}>
                    <Trash2 className='mr-1 h-4 w-4' /> Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
