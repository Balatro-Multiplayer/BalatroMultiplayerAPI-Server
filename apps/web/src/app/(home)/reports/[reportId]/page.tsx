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
      page && !page.submitted
        ? { ...page, report: { ...page.report, state } }
        : page
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
    mutationFn: () =>
      apiFetch(`/reports/${reportId}/withdraw`, { method: 'POST' }),
    onSuccess: () => setState('withdrawn'),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setState('decided')
    },
  })

  if (pending)
    return (
      <FlowPage>
        <FlowCard title='Loading' intro='One moment.' />
      </FlowPage>
    )
  if (!isLoggedIn) return null

  if (error instanceof ApiError && error.status === 403) {
    return (
      <FlowPage>
        <FlowCard
          title='Report unavailable'
          intro={"You can't view this report."}
        />
      </FlowPage>
    )
  }

  if (data?.submitted) {
    return (
      <FlowPage>
        <FlowCard
          title={SUBMITTED_TEXT}
          intro='This page opens once. You already used it.'
        />
      </FlowPage>
    )
  }

  const report = data?.report

  return (
    <FlowPage>
      {!report ? (
        <FlowCard title='Loading' intro='One moment.' />
      ) : (
        <FlowCard
          title='Report sent'
          intro={`Reason: ${TYPE_LABELS[report.type] ?? report.type}`}
        >
          {report.state === 'open' && (
            <>
              <p className='text-muted-foreground text-sm'>
                Your report is sent. A moderator will review it. You can add
                more detail below. This page opens once, so do it now.
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
            <p className='text-muted-foreground text-sm'>
              You withdrew this report. No action was taken.
            </p>
          )}
          {report.state === 'decided' && (
            <p className='text-muted-foreground text-sm'>
              Staff have already decided this report.
            </p>
          )}
        </FlowCard>
      )}
    </FlowPage>
  )
}
