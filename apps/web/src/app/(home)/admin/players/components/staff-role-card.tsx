'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  privilegesFor,
  ROLE_CHOICES,
  roleChangeError,
  roleChoiceOf,
  type StaffRoleChoice,
} from '../lib/staff-role'

// Admins only: change the role of a player. The change needs a note and goes
// in the staff log. The server refuses to demote the owner.
export function StaffRoleCard({
  playerId,
  privileges,
}: {
  playerId: string
  privileges: string[]
}) {
  const qc = useQueryClient()
  const current = roleChoiceOf(privileges)
  const [pick, setPick] = useState<StaffRoleChoice>(current)
  const [note, setNote] = useState('')
  const problem = roleChangeError(privileges, pick, note)

  const change = useMutation({
    mutationFn: () =>
      apiFetch(`/webadmin/players/${playerId}/privileges`, {
        method: 'PATCH',
        body: JSON.stringify({
          privileges: privilegesFor(privileges, pick),
          reason: note.trim(),
        }),
      }),
    onSuccess: () => {
      setNote('')
      qc.invalidateQueries({ queryKey: ['admin-player-page', playerId] })
      qc.invalidateQueries({ queryKey: ['admin-player-log', playerId] })
    },
  })

  return (
    <section
      className='space-y-3 rounded-lg border border-border bg-card/80 p-4'
      data-testid='staff-role-card'
    >
      <h3 className='font-pixel text-lg uppercase tracking-wide'>
        Staff role
        <span className='ml-2 rounded border border-bal-gold px-1 text-bal-gold text-xs'>
          Admin
        </span>
      </h3>
      <div className='grid grid-cols-3 gap-1'>
        {ROLE_CHOICES.map((r) => (
          <button
            key={r.key}
            type='button'
            aria-pressed={pick === r.key}
            onClick={() => setPick(r.key)}
            className={cn(
              'rounded border px-2 py-1 text-sm',
              pick === r.key
                ? 'border-bal-blue bg-bal-blue/20 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted'
            )}
          >
            {r.label}
            {r.key === current && (
              <span className='block text-[10px] uppercase'>Now</span>
            )}
          </button>
        ))}
      </div>
      <Input
        placeholder='Note for the staff log'
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label='Note for the role change'
      />
      {change.error && (
        <p className='text-bal-red text-sm' role='alert'>
          {change.error.message}
        </p>
      )}
      <Button
        size='sm'
        disabled={problem !== null || change.isPending}
        title={problem ?? undefined}
        onClick={() => change.mutate()}
      >
        {change.isPending ? 'Saving…' : 'Change role'}
      </Button>
    </section>
  )
}
