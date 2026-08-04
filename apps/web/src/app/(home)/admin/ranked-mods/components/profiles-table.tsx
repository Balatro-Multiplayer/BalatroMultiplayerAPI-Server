import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ModProfile } from './ranked-mods-types'

export function ProfilesTable({
  profiles,
  isAdmin,
  onManageEntries,
  onEdit,
  onDelete,
}: {
  profiles: ModProfile[]
  isAdmin: boolean
  onManageEntries: (profile: ModProfile) => void
  onEdit: (profile: ModProfile) => void
  onDelete: (profile: ModProfile) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Slug</TableHead>
          <TableHead>Description</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {profiles.map((profile) => (
          <TableRow key={profile.id}>
            <TableCell className='font-medium'>{profile.name}</TableCell>
            <TableCell className='font-mono text-xs'>{profile.slug}</TableCell>
            <TableCell className='text-muted-foreground'>
              {profile.description ?? '—'}
            </TableCell>
            <TableCell className='space-x-2 text-right'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => onManageEntries(profile)}
              >
                Mods
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => onEdit(profile)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => onDelete(profile)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </TableCell>
          </TableRow>
        ))}
        {profiles.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={4}
              className='text-center text-muted-foreground'
            >
              No ranked mod profiles yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
