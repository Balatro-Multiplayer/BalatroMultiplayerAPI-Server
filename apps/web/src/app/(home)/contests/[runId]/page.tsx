'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FlowCard, FlowPage } from '@/app/_components/flow-card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type PageState = 'open' | 'decided' | 'withdrawn'

type ContestPage =
  | { pending: true }
  | { submitted: true }
  | {
      submitted: false
      contest: {
        // 'in_game' | 'website'
        kind: string
        createdAt: string
        reason: string | null
        detail: string | null
        state: PageState
      }
    }

const REASONS: { key: string; label: string }[] = [
  { key: 'stalling', label: 'Stalling' },
  { key: 'rule_breaking', label: 'Rule breaking' },
  { key: 'other', label: 'Other' },
]

const SUBMITTED_TEXT = 'Submitted'

// The page the game opens after a Contest. The Contest exists before this
// page does, so the page may find it not stored yet: it asks again until it
// is. It opens once: asking again later gets only "Submitted".
export default function ContestPageView() {
  const { pending, isLoggedIn } = useAuth()
  const router = useRouter()
  const params = useParams()
  const runId = params.runId as string
  const qc = useQueryClient()
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notOver, setNotOver] = useState<string | null>(null)
  const pageKey = ['contest-page', runId]

  useEffect(() => {
    if (!pending && !isLoggedIn) router.replace('/login')
  }, [pending, isLoggedIn, router])

  const { data, error } = useQuery<ContestPage>({
    queryKey: pageKey,
    queryFn: async () =>
      (
        await apiFetch<{ page: ContestPage }>(`/contests/${runId}/open`, {
          method: 'POST',
        })
      ).page,
    enabled: isLoggedIn,
    retry: false,
    // A "pending" answer uses nothing up, so ask again until the Contest is stored.
    refetchInterval: (query) =>
      query.state.data && 'pending' in query.state.data ? 2000 : false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const setState = (state: PageState) =>
    qc.setQueryData<ContestPage>(pageKey, (page) =>
      page && 'contest' in page
        ? { ...page, contest: { ...page.contest, state } }
        : page
    )

  const refused = (err: unknown) => {
    if (!(err instanceof ApiError) || err.status !== 409) return
    if (err.message.startsWith('The match is not over')) setNotOver(err.message)
    else setState('decided')
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/contests/${runId}`, {
        method: 'PATCH',
        body: JSON.stringify({ reason, detail: detail ?? '' }),
      }),
    onSuccess: () => setSaved(true),
    onError: refused,
  })

  const withdrawMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/contests/${runId}/withdraw`, { method: 'POST' }),
    onSuccess: () => setState('withdrawn'),
    onError: (err) => {
      setConfirming(false)
      refused(err)
    },
  })

  if (pending)
    return (
      <FlowPage>
        <FlowCard title='Loading' intro='One moment.' />
      </FlowPage>
    )
  if (!isLoggedIn) return null

  if (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404)
  ) {
    return (
      <FlowPage>
        <FlowCard
          title='Contest unavailable'
          intro={"You can't view this Contest."}
        />
      </FlowPage>
    )
  }

  if (data && 'submitted' in data && data.submitted) {
    return (
      <FlowPage>
        <FlowCard
          title={SUBMITTED_TEXT}
          intro='This page opens once. You already used it.'
        />
      </FlowPage>
    )
  }

  const contest = data && 'contest' in data ? data.contest : undefined
  const currentReason = reason ?? contest?.reason ?? null

  return (
    <FlowPage>
      {!contest ? (
        <FlowCard title='Loading' intro='One moment.' />
      ) : (
        <FlowCard
          title='Contest sent'
          intro={'We sent your Contest to the moderators.'}
        >
          {contest.state === 'open' && (
            <>
              <p className='text-muted-foreground text-sm'>
                A moderator will review your Contest. Tell us why, and add any
                detail. This page opens once, so do it now.
              </p>
              <div className='flex flex-wrap gap-2'>
                {REASONS.map((r) => (
                  <Button
                    key={r.key}
                    variant={currentReason === r.key ? 'default' : 'outline'}
                    onClick={() => {
                      setReason(r.key)
                      setSaved(false)
                    }}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
              <Textarea
                aria-label='Added detail'
                placeholder='Add any further detail about what happened…'
                defaultValue={contest.detail ?? ''}
                onChange={(e) => {
                  setDetail(e.target.value)
                  setSaved(false)
                }}
                maxLength={2000}
                rows={5}
              />
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={
                    saveMutation.isPending ||
                    (reason === null && detail === null)
                  }
                >
                  Save
                </Button>
                {saved && (
                  <span className='text-muted-foreground text-sm'>Saved.</span>
                )}
                {confirming ? (
                  <>
                    <Button
                      variant='destructive'
                      onClick={() => withdrawMutation.mutate()}
                      disabled={withdrawMutation.isPending}
                    >
                      Confirm withdraw
                    </Button>
                    <Button
                      variant='ghost'
                      onClick={() => setConfirming(false)}
                    >
                      Keep Contest
                    </Button>
                  </>
                ) : (
                  <Button variant='outline' onClick={() => setConfirming(true)}>
                    Withdraw
                  </Button>
                )}
              </div>
              <p className='text-muted-foreground text-xs'>
                {contest.kind === 'website'
                  ? 'Withdraw removes your Contest. The match result does not change.'
                  : "Withdraw counts as a forfeit for you. Your opponent's result stands."}
              </p>
              {notOver && <p className='text-destructive text-sm'>{notOver}</p>}
            </>
          )}
          {contest.state === 'withdrawn' && (
            <p className='text-muted-foreground text-sm'>
              {contest.kind === 'website'
                ? 'You withdrew this Contest. The match result did not change.'
                : 'You withdrew this Contest. The match counts as a forfeit.'}
            </p>
          )}
          {contest.state === 'decided' && (
            <p className='text-muted-foreground text-sm'>
              Staff have already decided this match.
            </p>
          )}
        </FlowCard>
      )}
    </FlowPage>
  )
}
