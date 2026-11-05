'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { Empty, Facts } from '../../service-queue/components/evidence/shared'
import { formatTime } from '../../service-queue/lib/format'
import { playerHref } from '../../service-queue/lib/links'
import type { PlayerIdentity } from '../lib/types'

export const identityKey = (playerId: string) =>
  ['admin-player-identity', playerId] as const

// Identity data and the accounts a network ban links. Admins only: the page
// mounts this for admins and the server refuses anyone else.
export function useIdentity(playerId: string, enabled: boolean) {
  return useQuery<PlayerIdentity>({
    queryKey: identityKey(playerId),
    queryFn: () => apiFetch(`/webadmin/players/${playerId}/identity`),
    enabled,
    retry: false,
  })
}

export function LinkedAccountsTab({
  playerId,
  fromItem,
}: {
  playerId: string
  fromItem: number | null
}) {
  const { data, isError, isLoading } = useIdentity(playerId, true)
  if (isLoading) return <Empty>Loading…</Empty>
  if (isError || !data)
    return <Empty>Identity data is not available right now.</Empty>
  return (
    <div className='space-y-3'>
      <Facts
        rows={[
          ['Steam id hash', data.steamIdHash ?? '-'],
          ['Discord id hash', data.discordIdHash ?? '-'],
          ['Discord name', data.discordUsername ?? '-'],
          ['Networks (30 days)', String(data.networks.count)],
        ]}
      />
      {data.networks.hashes.length > 0 && (
        <ul className='font-mono text-muted-foreground text-xs'>
          {data.networks.hashes.map((n) => (
            <li key={n.hash} className='break-all'>
              {n.hash} (last seen {formatTime(n.lastSeen)})
            </li>
          ))}
        </ul>
      )}
      <h4 className='font-medium text-sm'>Network bans</h4>
      {data.networkBans.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <ul className='space-y-1'>
          {data.networkBans.map((b) => (
            <li
              key={b.banId}
              className='rounded-md border border-border p-2 text-sm'
            >
              {b.own ? 'Caused by this account' : 'Covers a network it used'},{' '}
              {b.networks} network{b.networks === 1 ? '' : 's'}, from{' '}
              {formatTime(b.bannedAt)}
              {b.liftedAt ? `, lifted ${formatTime(b.liftedAt)}` : ''}
            </li>
          ))}
        </ul>
      )}
      <h4 className='font-medium text-sm'>Linked accounts</h4>
      {data.linkedAccounts.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <ul className='space-y-1'>
          {data.linkedAccounts.map((a) => (
            <li
              key={a.playerId}
              className='rounded-md border border-border p-2 text-sm'
            >
              <Link
                href={playerHref(a.playerId, fromItem)}
                className='text-bal-blue hover:underline'
              >
                {a.name ?? a.playerId}
              </Link>{' '}
              (banned on a network this account used)
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
