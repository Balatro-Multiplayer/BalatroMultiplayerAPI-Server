import { Suspense } from 'react'
import { api, HydrateClient } from '@/trpc/server'
import { BountyCompletions } from './bounty-completions'

type Props = {
  params: Promise<{ id: string }>
}

export default async function BountyPage({ params }: Props) {
  const { id } = await params
  const bountyName = decodeURIComponent(id)

  await api.bounties.get_bounty_completions.prefetch({
    bounty_name: bountyName,
  })

  return (
    <Suspense>
      <HydrateClient>
        <div className='container max-w-2xl py-8'>
          <BountyCompletions bountyName={bountyName} />
        </div>
      </HydrateClient>
    </Suspense>
  )
}
