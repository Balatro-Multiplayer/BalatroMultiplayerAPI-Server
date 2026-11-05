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

type ReportPage =
  | { submitted: true }
  | {
      submitted: false
      report: {
        type: string
        createdAt: string
        additionalDetail: string | null
        state: PageState
      }
    }

const TYPE_LABELS: Record<string, string> = {
  cheating: 'Cheating',
  chat_abuse: 'Chat Abuse',
  griefing: 'Griefing',
  inappropriate_username: 'Inappropriate Username',
  other: 'Other',
}

const SUBMITTED_TEXT = 'Submitted'

// The page the game opens after a report (ADR 0011). It opens once: asking
// for it again later gets only "Submitted". The query below runs once and
// keeps its answer, so a refocus or a remount does not use the page up.
export default function ReportPageView() {
  const { pending, isLoggedIn } = useAuth()
  const router = useRouter()
  const params = useParams()
  const reportId = params.reportId as string
  const qc = useQueryClient()
  const [detail, setDetail] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const pageKey = ['report-page', reportId]

  useEffect(() => {
    if (!pending && !isLoggedIn) router.replace('/login')
  }, [pending, isLoggedIn, router])

  const { data, error } = useQuery<ReportPage>({
    queryKey: pageKey,
    queryFn: async () =>
      (
        await apiFetch<{ page: ReportPage }>(`/reports/${reportId}/open`, {
          method: 'POST',
        })
      ).page,
    enabled: isLoggedIn,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const setState = (state: PageState) =>
    qc.setQueryData<ReportPage>(pageKey, (page) =>
      page && !page.submitted ? { ...page, report: { ...page.report, state } } : page
    )

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ additionalDetail: detail ?? '' }),
      }),
    onSuccess: () => setSaved(true),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setState('decided')
    },
  })

  const withdrawMutation = useMutation({
    mutationFn: () => apiFetch(`/reports/${reportId}/withdraw`, { method: 'POST' }),
    onSuccess: () => setState('withdrawn'),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setState('decided')
    },
  })

  if (pending) return <div className='container max-w-lg py-8'>Loading…</div>
  if (!isLoggedIn) return null

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className='container max-w-lg py-8'>
        <p className='text-muted-foreground'>You're not authorized to view this report.</p>
      </div>
    )
  }

  if (data?.submitted) {
    return (
      <div className='container max-w-lg py-8'>
        <h1 className='text-2xl font-bold tracking-tight'>{SUBMITTED_TEXT}</h1>
      </div>
    )
  }

  const report = data?.report

  return (
    <div className='container max-w-lg py-8 space-y-6'>
      <h1 className='text-2xl font-bold tracking-tight'>Report sent</h1>

      {!report ? (
        <p className='text-muted-foreground'>Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{TYPE_LABELS[report.type] ?? report.type}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {report.state === 'open' && (
              <>
                <p className='text-sm text-muted-foreground'>
                  Your report is sent. A moderator will review it. You can add more detail below. This page opens
                  once, so do it now.
                </p>
                <Textarea
                  aria-label='Added detail'
                  placeholder='Add any further detail about what happened…'
                  defaultValue={report.additionalDetail ?? ''}
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
                    disabled={saveMutation.isPending || detail === null}
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
                        Keep report
                      </Button>
                    </>
                  ) : (
                    <Button variant='outline' onClick={() => setConfirming(true)}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </>
            )}
            {report.state === 'withdrawn' && (
              <p className='text-sm text-muted-foreground'>You withdrew this report. No action was taken.</p>
            )}
            {report.state === 'decided' && (
              <p className='text-sm text-muted-foreground'>Staff have already decided this report.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
