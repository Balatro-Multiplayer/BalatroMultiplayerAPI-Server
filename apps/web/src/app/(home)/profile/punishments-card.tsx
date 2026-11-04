'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { AppealControl } from './appeal-control'
import {
  endText,
  PUNISHMENT_LABEL,
  STATUS_LABEL,
  type PunishmentsResponse,
} from './punishments'

export function PunishmentsCard() {
  const [data, setData] = useState<PunishmentsResponse | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    apiFetch<PunishmentsResponse>('/auth/punishments').then(setData, () => setFailed(true))
  }, [])

  useEffect(load, [load])

  if (failed) return null
  if (!data) return null
  if (data.punishments.length === 0 && !data.networkBanned) return null

  return (
    <Card className='border-destructive/50'>
      <CardHeader>
        <CardTitle>Punishments</CardTitle>
        <CardDescription>
          {data.networkBanned
            ? 'Your network is banned from online play. You can appeal below.'
            : 'The punishments on your account.'}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {data.punishments.map((p, i) => (
          <div key={p.id} className='space-y-2'>
            {i > 0 && <Separator />}
            <div className='flex items-center justify-between'>
              <span className='font-medium'>{PUNISHMENT_LABEL[p.type]}</span>
              <Badge variant={p.status === 'active' ? 'destructive' : 'secondary'}>
                {STATUS_LABEL[p.status]}
              </Badge>
            </div>
            <div className='text-sm text-muted-foreground'>
              <div>Started: {formatDate(p.startsAt)}</div>
              <div>Ends: {endText(p, formatDate)}</div>
            </div>
            <p className='text-sm'>{p.reason || 'No reason given.'}</p>
            <AppealControl
              state={{ appeal: p.appeal, canAppeal: p.canAppeal, appealAvailableAt: p.appealAvailableAt }}
              punishmentId={p.id}
              onSubmitted={load}
            />
          </div>
        ))}
        {data.networkAppeal && (
          <div className='space-y-2'>
            {data.punishments.length > 0 && <Separator />}
            <span className='font-medium'>Network ban</span>
            <AppealControl state={data.networkAppeal} onSubmitted={load} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
