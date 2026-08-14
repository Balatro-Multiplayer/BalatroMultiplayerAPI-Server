import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AdminLobby {
  code: string
  hostName: string | null
  type: 'public' | 'private'
  playerCount: number
  maxPlayers: number
  isReported: boolean
}

export function LobbyList({
  lobbies,
  selectedCode,
  search,
  page,
  onSearchChange,
  onSelect,
  onPageChange,
}: {
  lobbies: AdminLobby[]
  selectedCode: string | null
  search: string
  page: number
  onSearchChange: (v: string) => void
  onSelect: (code: string) => void
  onPageChange: (p: number) => void
}) {
  return (
    <div className='space-y-3'>
      <Input
        placeholder='Search by code or username…'
        value={search}
        onChange={(e) => {
          onSearchChange(e.target.value)
          onPageChange(1)
        }}
      />
      <div className='max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border border-border p-1'>
        {lobbies.length === 0 ? (
          <p className='p-4 text-muted-foreground text-sm'>No lobbies found.</p>
        ) : (
          lobbies.map((l) => (
            <button
              key={l.code}
              type='button'
              onClick={() => onSelect(l.code)}
              className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors ${
                selectedCode === l.code
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <span className='font-mono font-semibold text-sm'>{l.code}</span>
              <span className='text-muted-foreground text-xs'>
                {l.hostName ?? l.code} · {l.playerCount}/{l.maxPlayers}
              </span>
              <div className='flex flex-wrap gap-1'>
                <Badge variant='outline' className='text-[10px]'>
                  {l.type}
                </Badge>
                {l.isReported && (
                  <Badge variant='destructive' className='text-[10px]'>
                    reported
                  </Badge>
                )}
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
        <span className='text-muted-foreground text-xs'>Page {page}</span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(page + 1)}
          disabled={lobbies.length < 50}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
