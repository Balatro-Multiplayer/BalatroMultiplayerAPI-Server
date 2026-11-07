'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface FoundPlayer {
  id: string
  steamName: string
  privileges: string[]
  activeBans: number
}

// Staff find a player by name or by player id, then open the player page.
export default function AdminPlayersPage() {
  const { isAdmin, isModerator } = useAuth()
  const [search, setSearch] = useState('')
  const term = search.trim()
  const { data } = useQuery<{ players: FoundPlayer[] }>({
    queryKey: ['admin-player-search', term],
    queryFn: () =>
      apiFetch(
        `/webadmin/players?limit=25${term ? `&search=${encodeURIComponent(term)}` : ''}`
      ),
    enabled: isAdmin || isModerator,
  })
  return (
    <div className='container max-w-3xl space-y-4 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>Players</h1>
        <p className='text-muted-foreground text-sm'>
          Search by name, player id or Nakama id.
        </p>
      </div>
      <Input
        placeholder='Name or id'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className='divide-y divide-border rounded-lg border border-border'>
        {(data?.players ?? []).length === 0 && (
          <li className='p-4 text-muted-foreground text-sm'>
            No players found.
          </li>
        )}
        {(data?.players ?? []).map((p) => (
          <li key={p.id}>
            <Link
              href={`/admin/players/${p.id}`}
              className='flex items-center gap-2 px-3 py-2 hover:bg-muted'
            >
              <span className='font-semibold text-sm'>{p.steamName}</span>
              {p.activeBans > 0 && (
                <Badge variant='destructive' className='text-[10px]'>
                  {p.activeBans} ban{p.activeBans === 1 ? '' : 's'}
                </Badge>
              )}
              {p.privileges.map((pr) => (
                <Badge key={pr} variant='outline' className='text-[10px]'>
                  {pr}
                </Badge>
              ))}
              <span className='ml-auto font-mono text-muted-foreground text-xs'>
                {p.id}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
