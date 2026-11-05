import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface AdminLobby {
  code: string
  modId: string
  type: 'public' | 'private'
  mode?: string
  started?: boolean
  playerCount: number
  maxPlayers: number
}

export const LOBBY_PAGE_SIZE = 50

export function LobbyList({
  lobbies,
  total,
  selectedCode,
  search,
  page,
  onSearchChange,
  onSelect,
  onPageChange,
}: {
  lobbies: AdminLobby[]
  total: number
  selectedCode: string | null
  search: string
  page: number
  onSearchChange: (v: string) => void
  onSelect: (code: string) => void
  onPageChange: (p: number) => void
}) {
  return (
    <div className='flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card/80'>
      <div className='border-border border-b p-3'>
        <Input
          placeholder='Search by code'
          aria-label='Search lobbies by code'
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value)
            onPageChange(1)
          }}
        />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto' data-testid='lobby-list'>
        {lobbies.length === 0 ? (
          <p className='p-4 text-muted-foreground text-sm'>No lobbies found.</p>
        ) : (
          lobbies.map((l) => (
            <button
              key={l.code}
              type='button'
              onClick={() => onSelect(l.code)}
              aria-current={selectedCode === l.code}
              className={cn(
                'flex w-full flex-col gap-1.5 border-border border-b px-4 py-3 text-left transition-colors',
                selectedCode === l.code
                  ? 'border-l-2 border-l-destructive bg-destructive/10'
                  : 'hover:bg-muted'
              )}
            >
              <span className='flex items-baseline justify-between'>
                <span className='font-mono font-semibold'>{l.code}</span>
                <span className='font-bold'>
                  {l.playerCount}/{l.maxPlayers}
                </span>
              </span>
              <span className='flex flex-wrap gap-1'>
                <Badge variant='outline'>{l.type}</Badge>
                <Badge variant='outline'>{l.modId}</Badge>
                {l.started && <Badge variant='outline'>in match</Badge>}
              </span>
            </button>
          ))
        )}
      </div>
      <div className='flex items-center justify-between border-border border-t p-3'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className='text-muted-foreground text-sm'>
          Page {page}, {total} total
        </span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(page + 1)}
          disabled={page * LOBBY_PAGE_SIZE >= total}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
