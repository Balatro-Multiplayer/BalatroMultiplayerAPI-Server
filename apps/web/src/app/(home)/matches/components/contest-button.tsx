'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ApiError, apiFetch } from '@/lib/api'

// The Contest button on a match the player played in. The server decides who
// may contest (a matchmade Ranked or Casual match, within 24 hours after it
// ended, not voided, not contested by them yet); the button shows only when it
// says yes. A website Contest leaves the result as it is. It opens the
// Contest's page, which takes the reason and text and opens once.
export function ContestButton({ runId }: { runId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)

  const { data } = useQuery<{ eligible: boolean }>({
    queryKey: ['contest-eligibility', runId],
    queryFn: () => apiFetch(`/contests/${runId}/eligibility`),
    retry: false,
  })

  const contest = useMutation({
    mutationFn: () => apiFetch(`/contests/${runId}`, { method: 'POST' }),
    onSuccess: () => router.push(`/contests/${runId}`),
  })

  if (!data?.eligible) return null

  return (
    <div className='space-y-2'>
      {confirming ? (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            variant='destructive'
            disabled={contest.isPending}
            onClick={() => contest.mutate()}
          >
            Confirm Contest
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <span className='text-muted-foreground text-xs'>
            The result stands until a moderator decides. You can contest a match once.
          </span>
        </div>
      ) : (
        <Button size='sm' variant='outline' onClick={() => setConfirming(true)}>
          Contest this match
        </Button>
      )}
      {contest.isError && (
        <p className='text-destructive text-sm'>
          {contest.error instanceof ApiError
            ? contest.error.message
            : 'Could not send the Contest. Please try again.'}
        </p>
      )}
    </div>
  )
}
