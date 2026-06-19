'use client'

import { useState } from 'react'
import { sumBy } from 'remeda'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ActiveMatchQueue } from '@/server/services/botlatro.service'
import { api } from '@/trpc/react'

export function LiveMatchesTab() {
  const [liveQueues, setLiveQueues] = useState<ActiveMatchQueue[] | null>(null)
  const { data: initialQueues } = api.playerState.getActiveMatches.useQuery(
    undefined,
    { refetchInterval: 30_000 } // poll every 30s as a fallback
  )

  api.playerState.onActiveMatchesChange.useSubscription(undefined, {
    onData: (event) => setLiveQueues(event.data),
  })

  const queues = liveQueues ?? initialQueues ?? []
  const total = sumBy(queues, (q) => q.active_matches)
  const totalInQueue = sumBy(queues, (q) => q.players_in_queue)

  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6'>
      <QueueCard label='Total' count={total} inQueue={totalInQueue} />
      {queues.map((queue) => (
        <QueueCard
          key={queue.queue_id}
          label={queue.queue_name}
          count={queue.active_matches}
          inQueue={queue.players_in_queue}
        />
      ))}
    </div>
  )
}

function QueueCard({
  label,
  count,
  inQueue,
}: {
  label: string
  count: number
  inQueue: number
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 font-medium text-sm'>
          <span className='relative flex h-2 w-2'>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
            <span className='relative inline-flex h-2 w-2 rounded-full bg-emerald-500' />
          </span>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className='font-bold text-4xl'>{count}</p>
        <p className='text-muted-foreground text-sm'>
          active {count === 1 ? 'match' : 'matches'}
        </p>
        <p className='mt-1 text-muted-foreground text-sm'>{inQueue} in queue</p>
      </CardContent>
    </Card>
  )
}
