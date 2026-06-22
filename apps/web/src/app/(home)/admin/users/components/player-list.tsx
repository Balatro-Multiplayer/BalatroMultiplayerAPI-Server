import type { Privilege } from '@bmp/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AdminPlayer {
  id: string
  steamName: string
  privileges: Privilege[]
  activeBans: number
}

export function PlayerList({
  players,
  selectedId,
  search,
  page,
  onSearchChange,
  onSelect,
  onPageChange,
}: {
  players: AdminPlayer[]
  selectedId: string | null
  search: string
  page: number
  onSearchChange: (v: string) => void
  onSelect: (id: string) => void
  onPageChange: (p: number) => void
}) {
  return (
    <div className='space-y-3'>
      <Input
        placeholder='Search players…'
        value={search}
        onChange={(e) => {
          onSearchChange(e.target.value)
          onPageChange(1)
        }}
      />
      <div className='max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border border-border p-1'>
        {players.length === 0 ? (
          <p className='p-4 text-sm text-muted-foreground'>No players found.</p>
        ) : (
          players.map((p) => (
            <button
              key={p.id}
              type='button'
              onClick={() => onSelect(p.id)}
              className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors ${
                selectedId === p.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <span className='font-semibold text-sm'>{p.steamName}</span>
              <div className='flex flex-wrap gap-1'>
                {p.activeBans > 0 && (
                  <Badge variant='destructive' className='text-[10px]'>
                    {p.activeBans} ban{p.activeBans === 1 ? '' : 's'}
                  </Badge>
                )}
                {p.privileges.map((pr) => (
                  <Badge key={pr} variant='outline' className='text-[10px] text-bal-gold'>
                    {pr}
                  </Badge>
                ))}
              </div>
            </button>
          ))
        )}
      </div>
      <div className='flex items-center justify-between'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className='text-xs text-muted-foreground'>Page {page}</span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(page + 1)}
          disabled={players.length < 50}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
