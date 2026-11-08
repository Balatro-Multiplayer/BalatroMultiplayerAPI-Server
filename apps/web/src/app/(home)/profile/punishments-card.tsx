'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { AppealControl } from './appeal-control'
import {
  endText,
  PUNISHMENT_LABEL,
  type PunishmentsResponse,
  STATUS_LABEL,
} from './punishments'

export function usePunishments() {
  const [data, setData] = useState<PunishmentsResponse | null>(null)

  const load = useCallback(() => {
    apiFetch<PunishmentsResponse>('/auth/punishments').then(setData, () => {})
  }, [])

  useEffect(load, [load])

  return { data, load }
}

export function PunishmentsList({
  data,
  onChange,
}: {
  data: PunishmentsResponse
  onChange: () => void
}) {
  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        {data.networkBanned
          ? 'Your network is banned from online play. You can appeal below.'
          : 'The punishments on your account.'}
      </p>
      {data.punishments.map((p, i) => (
        <div key={p.id} className='space-y-2'>
          {i > 0 && <Separator />}
          <div className='flex items-center justify-between'>
            <span className='font-medium'>{PUNISHMENT_LABEL[p.type]}</span>
            <Badge
              variant={p.status === 'active' ? 'destructive' : 'secondary'}
            >
              {STATUS_LABEL[p.status]}
            </Badge>
          </div>
          <div className='text-muted-foreground text-sm'>
            <div>Started: {formatDate(p.startsAt)}</div>
            <div>Ends: {endText(p, formatDate)}</div>
          </div>
          <p className='text-sm'>{p.reason || 'No reason given.'}</p>
          <AppealControl
            state={{
              appeal: p.appeal,
              canAppeal: p.canAppeal,
              appealAvailableAt: p.appealAvailableAt,
            }}
            punishmentId={p.id}
            onSubmitted={onChange}
          />
        </div>
      ))}
      {data.networkAppeal && (
        <div className='space-y-2'>
          {data.punishments.length > 0 && <Separator />}
          <span className='font-medium'>Network ban</span>
          <AppealControl state={data.networkAppeal} onSubmitted={onChange} />
        </div>
      )}
    </div>
  )
}
