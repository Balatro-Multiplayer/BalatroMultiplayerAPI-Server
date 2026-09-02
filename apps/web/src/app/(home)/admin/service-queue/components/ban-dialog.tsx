'use client'

import type { BanType } from '@bmp/types'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Shared across report/flagged-chat/anti-cheat detail views -- each just
// wires isOpen/isPending/onConfirm/onClose to its own "Ban" mutation
// (PATCH .../actions/ban), self-contained state so it doesn't need to be
// threaded through 3 different parent components.
export function BanDialog({
  open,
  isPending,
  onConfirm,
  onClose,
}: {
  open: boolean
  isPending: boolean
  onConfirm: (params: { banType: BanType; reason: string; expiresAt: string | null }) => void
  onClose: () => void
}) {
  const [banType, setBanType] = useState<BanType>('chat')
  const [reason, setReason] = useState('')
  const [expiry, setExpiry] = useState('')

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ban this player?</AlertDialogTitle>
          <AlertDialogDescription>
            Takes effect immediately. Leave the date blank for an indefinite ban.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className='space-y-2'>
          <Input placeholder='Reason' value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className='flex gap-2'>
            <Select value={banType} onValueChange={(v) => setBanType(v as BanType)}>
              <SelectTrigger className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='chat'>Chat</SelectItem>
                <SelectItem value='queue'>Queue</SelectItem>
                <SelectItem value='account'>Account</SelectItem>
              </SelectContent>
            </Select>
            <Input type='date' value={expiry} onChange={(e) => setExpiry(e.target.value)} className='flex-1' />
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant='outline' disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || isPending}
            onClick={() =>
              onConfirm({
                banType,
                reason,
                expiresAt: expiry ? new Date(expiry).toISOString() : null,
              })
            }
            className='bg-destructive text-white hover:bg-destructive/90'
          >
            {isPending ? 'Banning…' : 'Ban'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
