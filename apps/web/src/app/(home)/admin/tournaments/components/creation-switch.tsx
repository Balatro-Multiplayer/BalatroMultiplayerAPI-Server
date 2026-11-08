'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/api'

type Settings = { creationRestricted: boolean }

// Whether only players with the tournament_create (or tournament_official)
// privilege may create tournaments. Admins change it; flipping the switch
// only opens a dialog, and nothing changes until it is confirmed with a
// reason (staff log).
export function CreationSwitch({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')

  const { data } = useQuery<Settings>({
    queryKey: ['admin-tournament-settings'],
    queryFn: () => apiFetch('/webadmin/tournaments/settings'),
  })

  const mutation = useMutation({
    mutationFn: (vars: { restricted: boolean; reason: string }) =>
      apiFetch<Settings>('/webadmin/tournaments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          creationRestricted: vars.restricted,
          reason: vars.reason,
        }),
      }),
    onSuccess: (next) => {
      qc.setQueryData(['admin-tournament-settings'], next)
      setPending(null)
    },
  })

  if (!data) return null
  const trimmed = reason.trim()
  const error =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Could not change the setting.'
        : null

  return (
    <div className='flex items-center gap-3 rounded-lg border border-border px-4 py-3'>
      <div className='space-y-0.5'>
        <Label htmlFor='tournament-creation-restricted'>
          Only privileged players can create tournaments
        </Label>
        <p className='text-muted-foreground text-xs'>
          Needs the <span className='font-mono'>tournament_create</span> or{' '}
          <span className='font-mono'>tournament_official</span> privilege.
          Running a tournament someone already has never does.
        </p>
      </div>
      <Switch
        id='tournament-creation-restricted'
        checked={data.creationRestricted}
        disabled={!isAdmin}
        onCheckedChange={(checked) => {
          setReason('')
          mutation.reset()
          setPending(checked)
        }}
      />

      <AlertDialog
        open={pending !== null}
        onOpenChange={(o) => !o && !mutation.isPending && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending
                ? 'Restrict tournament creation?'
                : 'Let everyone create tournaments?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? 'Only players with the tournament_create or tournament_official privilege will be able to create tournaments. Tournaments that already exist carry on as they are.'
                : 'Every player with the Organiser mod will be able to create tournaments (at most 10 a day and 5 at once each).'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='space-y-1'>
            <Label htmlFor='tournament-creation-reason'>
              Reason (saved in the staff log)
            </Label>
            <Textarea
              id='tournament-creation-reason'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error && <p className='text-destructive text-xs'>{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending || trimmed === ''}
              onClick={(e) => {
                // Stays open until the change goes through (or fails).
                e.preventDefault()
                if (pending !== null)
                  mutation.mutate({ restricted: pending, reason: trimmed })
              }}
            >
              {mutation.isPending
                ? 'Saving…'
                : pending
                  ? 'Restrict'
                  : 'Let everyone create'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
