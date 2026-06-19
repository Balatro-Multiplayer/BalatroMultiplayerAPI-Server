'use client'

import { format } from 'date-fns'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { api, type RouterOutputs } from '@/trpc/react'

type BountyCompletion =
  RouterOutputs['bounties']['get_bounty_completions']['completions'][number]

function bountyNameToIconPath(bountyName: string): string {
  const slug = bountyName
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
  return `/bounties/${slug}.png`
}

function CompletionRow({
  completion,
  index,
}: {
  completion: BountyCompletion
  index: number
}) {
  return (
    <Link
      href={`/players/${completion.user_id}`}
      className='flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50'
    >
      <span className='w-6 text-right text-muted-foreground text-sm tabular-nums'>
        {index + 1}
      </span>
      <span className='flex-1 font-medium text-sm'>
        {completion.display_name}
      </span>
      {completion.is_first && (
        <span className='rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 text-xs dark:text-amber-400'>
          First
        </span>
      )}
      <span className='text-muted-foreground text-xs'>
        {format(new Date(completion.completed_at), 'MMM d, yyyy')}
      </span>
    </Link>
  )
}

export function BountyCompletions({ bountyName }: { bountyName: string }) {
  const [imgError, setImgError] = useState(false)
  const { data, isLoading } = api.bounties.get_bounty_completions.useQuery({
    bounty_name: bountyName,
  })

  if (isLoading) {
    return (
      <div className='flex h-32 items-center justify-center'>
        <span className='text-muted-foreground text-sm'>Loading...</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className='flex h-32 items-center justify-center rounded-lg border'>
        <span className='text-muted-foreground text-sm'>Bounty not found</span>
      </div>
    )
  }

  const { bounty, completions } = data
  const iconPath = bountyNameToIconPath(bounty.bounty_name)
  const firstCompletion = completions.find((c) => c.is_first)
  const sorted = [...completions].sort(
    (a, b) =>
      new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
  )

  return (
    <div className='space-y-6'>
      {/* Bounty header */}
      <div className='flex items-start gap-4 rounded-lg border bg-card p-6'>
        <div
          className={cn(
            'relative shrink-0 rounded-md',
            'shadow-[0_0_16px_6px_rgba(251,191,36,0.4)] ring-2 ring-amber-400/80 ring-offset-2 ring-offset-background'
          )}
        >
          <Image
            src={imgError ? '/bounties/placeholder.png' : iconPath}
            alt={bounty.bounty_name}
            width={256}
            height={256}
            className='size-24 rounded-md object-contain'
            unoptimized
            onError={() => setImgError(true)}
          />
        </div>
        <div className='min-w-0 flex-1'>
          <h1 className='font-bold text-2xl'>{bounty.bounty_name}</h1>
          <p className='mt-1 text-muted-foreground text-sm'>
            {bounty.description}
          </p>
          <p className='mt-3 text-muted-foreground text-sm'>
            <span className='font-medium text-foreground'>
              {completions.length}
            </span>{' '}
            {completions.length === 1 ? 'completion' : 'completions'}
          </p>
        </div>
      </div>

      {/* First completion callout */}
      {firstCompletion && (
        <div className='rounded-lg border border-amber-400/40 bg-amber-500/5 p-4'>
          <h2 className='mb-3 font-semibold text-amber-500 dark:text-amber-400'>
            First Completion
          </h2>
          <Link
            href={`/players/${firstCompletion.user_id}`}
            className='flex items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-amber-500/10'
          >
            <span className='font-medium text-sm'>
              {firstCompletion.display_name}
            </span>
            <span className='ml-auto text-muted-foreground text-xs'>
              {format(new Date(firstCompletion.completed_at), 'MMM d, yyyy')}
            </span>
          </Link>
        </div>
      )}

      {/* All completions */}
      {sorted.length > 0 && (
        <div className='rounded-lg border bg-card'>
          <div className='border-b px-3 py-3'>
            <h2 className='font-semibold text-sm'>All Completions</h2>
          </div>
          <div className='max-h-[32rem] divide-y overflow-y-auto'>
            {sorted.map((completion, index) => (
              <CompletionRow
                key={completion.id}
                completion={completion}
                index={index}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
