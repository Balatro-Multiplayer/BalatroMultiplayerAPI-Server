'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

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
    refetchInterval: (query) => (query.state.data && 'pending' in query.state.data ? 2000 : false),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const setState = (state: PageState) =>
    qc.setQueryData<ContestPage>(pageKey, (page) =>
      page && 'contest' in page ? { ...page, contest: { ...page.contest, state } } : page
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
    mutationFn: () => apiFetch(`/contests/${runId}/withdraw`, { method: 'POST' }),
    onSuccess: () => setState('withdrawn'),
    onError: (err) => {
      setConfirming(false)
      refused(err)
    },
  })

  if (pending) return <div className='container max-w-lg py-8'>Loading…</div>
  if (!isLoggedIn) return null

  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return (
      <div className='container max-w-lg py-8'>
        <p className='text-muted-foreground'>You can't view this Contest.</p>
      </div>
    )
  }

  if (data && 'submitted' in data && data.submitted) {
    return (
      <div className='container max-w-lg py-8'>
        <h1 className='text-2xl font-bold tracking-tight'>{SUBMITTED_TEXT}</h1>
      </div>
    )
  }

  const contest = data && 'contest' in data ? data.contest : undefined
  const currentReason = reason ?? contest?.reason ?? null

  return (
    <div className='container max-w-lg py-8 space-y-6'>
      <h1 className='text-2xl font-bold tracking-tight'>Contest sent</h1>

      {!contest ? (
        <p className='text-muted-foreground'>Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your Contest</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {contest.state === 'open' && (
              <>
                <p className='text-sm text-muted-foreground'>
                  A moderator will review your Contest. Tell us why, and add any detail. This page opens once, so do
                  it now.
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
                    disabled={saveMutation.isPending || (reason === null && detail === null)}
                  >
                    Save
                  </Button>
                  {saved && <span className='text-sm text-muted-foreground'>Saved.</span>}
                  {confirming ? (
                    <>
                      <Button
                        variant='destructive'
                        onClick={() => withdrawMutation.mutate()}
                        disabled={withdrawMutation.isPending}
                      >
                        Confirm withdraw
                      </Button>
                      <Button variant='ghost' onClick={() => setConfirming(false)}>
                        Keep Contest
                      </Button>
                    </>
                  ) : (
                    <Button variant='outline' onClick={() => setConfirming(true)}>
                      Withdraw
                    </Button>
                  )}
                </div>
                <p className='text-xs text-muted-foreground'>
                  {contest.kind === 'website'
                    ? 'Withdraw removes your Contest. The match result does not change.'
                    : "Withdraw counts as a forfeit for you. Your opponent's result stands."}
                </p>
                {notOver && <p className='text-sm text-destructive'>{notOver}</p>}
              </>
            )}
            {contest.state === 'withdrawn' && (
              <p className='text-sm text-muted-foreground'>
                {contest.kind === 'website'
                  ? 'You withdrew this Contest. The match result did not change.'
                  : 'You withdrew this Contest. The match counts as a forfeit.'}
              </p>
            )}
            {contest.state === 'decided' && (
              <p className='text-sm text-muted-foreground'>Staff have already decided this match.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
