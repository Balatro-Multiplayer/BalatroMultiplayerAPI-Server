'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

interface MyReport {
  id: number
  type: string
  status: 'open' | 'resolved'
  additionalDetail: string | null
  createdAt: string
}

const TYPE_LABELS: Record<string, string> = {
  cheating: 'Cheating',
  chat_abuse: 'Chat Abuse',
  griefing: 'Griefing',
  inappropriate_username: 'Inappropriate Username',
  other: 'Other',
}

export default function MyReportStatusPage() {
  const { pending, isLoggedIn } = useAuth()
  const router = useRouter()
  const params = useParams()
  const reportId = params.reportId as string
  const qc = useQueryClient()
  const [detail, setDetail] = useState('')

  useEffect(() => {
    if (!pending && !isLoggedIn) router.replace('/login')
  }, [pending, isLoggedIn, router])

  const { data, error } = useQuery<{ report: MyReport }>({
    queryKey: ['my-report', reportId],
    queryFn: () => apiFetch(`/reports/${reportId}`),
    enabled: isLoggedIn,
    retry: false,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ additionalDetail: detail }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-report', reportId] }),
  })

  if (pending) return <div className='container max-w-lg py-8'>Loading…</div>
  if (!isLoggedIn) return null

  // This link was handed directly to one specific player (§15.5) -- a 403
  // means they're not that player, not a reason to bounce them elsewhere.
  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className='container max-w-lg py-8'>
        <p className='text-muted-foreground'>You're not authorized to view this report.</p>
      </div>
    )
  }

  const report = data?.report

  return (
    <div className='container max-w-lg py-8 space-y-6'>
      <h1 className='text-2xl font-bold tracking-tight'>Report Status</h1>

      {!report ? (
        <p className='text-muted-foreground'>Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center justify-between'>
              <span>{TYPE_LABELS[report.type] ?? report.type}</span>
              <Badge variant={report.status === 'open' ? 'destructive' : 'secondary'}>
                {report.status === 'open' ? 'Open' : 'Resolved'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <p className='text-sm text-muted-foreground'>
              Filed {new Date(report.createdAt).toLocaleString()}. A moderator will review this report; you
              can add more detail below if it helps.
            </p>
            <Textarea
              placeholder='Add any further detail about what happened…'
              defaultValue={report.additionalDetail ?? ''}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={2000}
              rows={5}
            />
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              Save
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
