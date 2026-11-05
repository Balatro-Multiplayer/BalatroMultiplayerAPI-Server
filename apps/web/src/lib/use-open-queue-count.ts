'use client'

import { apiFetch } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'

const REFRESH_MS = 60_000

// The number of open queue items in the main lane (the Automatic lane has
// its own filter and is not counted here). Refreshes every minute.
export function useOpenQueueCount(enabled: boolean): number | undefined {
  const { data } = useQuery({
    queryKey: ['service-queue', 'open-main-count'],
    queryFn: () =>
      apiFetch<{ total: number }>(
        '/webadmin/service-queue?status=open&lane=main&limit=1',
      ),
    enabled,
    refetchInterval: REFRESH_MS,
    select: (list) => list.total,
  })
  return data
}
