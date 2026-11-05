import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { daysLeft, formatDay, type Season } from './seasons-types'

export function ActiveSeasonCard({
  season,
  busy,
  onEnd,
}: {
  season: Season | undefined
  busy: boolean
  onEnd: (season: Season) => void
}) {
  if (!season) {
    return (
      <section className='rounded-xl border border-border bg-card p-4'>
        <h2 className='font-pixel text-lg'>Active season</h2>
        <p className='mt-2 text-muted-foreground text-sm'>
          No season is active. Results go under no season until you start or
          activate one.
        </p>
      </section>
    )
  }
  const left = daysLeft(season.endsAt)
  return (
    <section className='rounded-xl border border-border bg-card p-4'>
      <div className='flex items-center gap-2'>
        <h2 className='font-pixel text-lg'>Active season</h2>
        <Badge>Active</Badge>
      </div>
      <div className='mt-3 flex flex-wrap items-end gap-x-8 gap-y-3'>
        <div>
          <p className='font-pixel text-2xl'>{season.name}</p>
          <p className='font-mono text-muted-foreground text-xs'>
            id {season.id}
          </p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>Started</p>
          <p className='font-semibold text-sm'>{formatDay(season.startedAt)}</p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>Ends</p>
          <p className='font-semibold text-sm'>{formatDay(season.endsAt)}</p>
        </div>
        {left !== null && (
          <div>
            <p className='text-muted-foreground text-xs'>Days left</p>
            <p className='font-pixel text-xl'>{left}</p>
          </div>
        )}
        <Button
          variant='outline'
          className='ml-auto border-destructive/60 text-destructive'
          disabled={busy}
          onClick={() => onEnd(season)}
        >
          End season…
        </Button>
      </div>
    </section>
  )
}
