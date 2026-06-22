import type { BanType } from '@bmp/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Ban {
  id: number
  reason: string
  banType: BanType
  expiresAt: string | null
  liftedAt: string | null
  createdAt: string
}

export function BanList({
  bans,
  liftPending,
  onLift,
}: {
  bans: Ban[]
  liftPending: boolean
  onLift: (banId: number) => void
}) {
  if (bans.length === 0) {
    return <p className='text-sm text-muted-foreground'>No bans on record.</p>
  }

  return (
    <div className='space-y-2'>
      {bans.map((ban) => {
        const active =
          !ban.liftedAt && (!ban.expiresAt || new Date(ban.expiresAt) > new Date())
        return (
          <div
            key={ban.id}
            className='flex items-start justify-between gap-3 rounded-md border border-border p-2 text-sm'
          >
            <div className='space-y-0.5'>
              <div className='flex items-center gap-2'>
                <Badge variant={active ? 'destructive' : 'outline'}>
                  {ban.banType}
                </Badge>
                {!active && (
                  <span className='text-xs text-muted-foreground'>
                    {ban.liftedAt ? 'lifted' : 'expired'}
                  </span>
                )}
              </div>
              <p className='text-muted-foreground'>{ban.reason || 'No reason given'}</p>
              {ban.expiresAt && (
                <p className='text-xs text-muted-foreground'>
                  until {new Date(ban.expiresAt).toLocaleDateString()}
                </p>
              )}
            </div>
            {active && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => onLift(ban.id)}
                disabled={liftPending}
              >
                Lift
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
