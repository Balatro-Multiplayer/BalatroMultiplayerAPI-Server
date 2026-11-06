import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type AdminTournament,
  formatTime,
  isOver,
  type ListFilter,
  STATUS_LABEL,
} from './tournament-types'

const FILTERS: { value: ListFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'over', label: 'Ended' },
  { value: 'all', label: 'All' },
]

export function TournamentList({
  tournaments,
  total,
  selectedId,
  search,
  filter,
  page,
  limit,
  onSearchChange,
  onFilterChange,
  onSelect,
  onPageChange,
}: {
  tournaments: AdminTournament[]
  total: number
  selectedId: string | null
  search: string
  filter: ListFilter
  page: number
  limit: number
  onSearchChange: (v: string) => void
  onFilterChange: (v: ListFilter) => void
  onSelect: (id: string) => void
  onPageChange: (p: number) => void
}) {
  return (
    <div className='space-y-3'>
      <Input
        placeholder='Search by name, organiser or invite code…'
        value={search}
        onChange={(e) => {
          onSearchChange(e.target.value)
          onPageChange(1)
        }}
      />
      <div className='flex gap-1'>
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? 'default' : 'ghost'}
            size='sm'
            onClick={() => {
              onFilterChange(f.value)
              onPageChange(1)
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <div className='max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border border-border p-1'>
        {tournaments.length === 0 ? (
          <p className='p-4 text-muted-foreground text-sm'>
            No tournaments found.
          </p>
        ) : (
          tournaments.map((t) => (
            <button
              key={t.id}
              type='button'
              onClick={() => onSelect(t.id)}
              className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors ${
                selectedId === t.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <span className='break-words font-semibold text-sm'>
                {t.name}
              </span>
              <span className='text-muted-foreground text-xs'>
                {t.organiserName} · {t.players}/{t.maxPlayers} ·{' '}
                {isOver(t.status)
                  ? `ended ${formatTime(t.finishedAt)}`
                  : `starts ${formatTime(t.startsAt)}`}
              </span>
              <div className='flex flex-wrap gap-1'>
                <Badge
                  variant={t.status === 'cancelled' ? 'destructive' : 'outline'}
                  className='text-[10px]'
                >
                  {STATUS_LABEL[t.status]}
                </Badge>
                <Badge variant='outline' className='text-[10px]'>
                  {t.visibility}
                </Badge>
                {t.official && (
                  <Badge
                    variant='outline'
                    className='text-[10px] text-bal-gold'
                  >
                    official
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
        <span className='text-muted-foreground text-xs'>
          Page {page} · {total} total
        </span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(page + 1)}
          disabled={page * limit >= total}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
