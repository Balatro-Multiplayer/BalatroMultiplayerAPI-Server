'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { ApiError, apiFetch } from '@/lib/api'
import { setToken } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { BirthdayPicker } from './birthday-picker'

function TosContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingToken = searchParams.get('token')
  const isUpdate = searchParams.get('update') === '1'

  const [age, setAge] = useState<number | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dateComplete = age !== null
  const chatEligible = age !== null && age >= 16
  const canSubmit = !isUpdate && dateComplete && agreed && !!pendingToken
  const canSubmitUpdate = isUpdate && !!pendingToken

  async function handleAccept() {
    if (!pendingToken) return
    if (!isUpdate) {
      if (!dateComplete || !agreed) return
      if (age !== null && age < 13) {
        setBlocked(true)
        return
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      const data = await apiFetch<{ token: string }>('/auth/accept-tos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pendingToken}` },
        body: JSON.stringify({ chatEligible: isUpdate ? undefined : chatEligible }),
      })
      setToken(data.token)
      router.replace('/profile')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (blocked) {
    return (
      <div className='flex min-h-screen items-center justify-center p-6'>
        <Card className='w-full max-w-md'>
          <CardHeader>
            <CardTitle>Account creation is unavailable.</CardTitle>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (isUpdate) {
    return (
      <div className='flex min-h-screen items-center justify-center p-6'>
        <Card className='w-full max-w-md'>
          <CardHeader>
            <CardTitle>Before You Play</CardTitle>
          </CardHeader>
          <CardContent className='space-y-6'>
            <div className='space-y-2 text-sm text-muted-foreground'>
              <p>The Privacy &amp; Terms Notice has been updated.</p>
              <p>Please review and accept to continue.</p>
            </div>
            <Button variant='outline' className='w-full' asChild>
              <a href='/notice' target='_blank' rel='noreferrer'>View Privacy &amp; Terms Notice</a>
            </Button>
            {error && <p className='text-sm text-destructive'>{error}</p>}
            <Button className='w-full' disabled={!canSubmitUpdate || submitting} onClick={handleAccept}>
              {submitting ? 'Submitting…' : 'I Accept'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Before You Play</CardTitle>
          <p className='text-sm text-muted-foreground'>A couple of things to sort out first.</p>
        </CardHeader>
        <CardContent className='space-y-6'>

          <BirthdayPicker onAgeChange={setAge} />
          {dateComplete && !chatEligible && (
            <p className='text-xs text-yellow-400'>
              You must be 16 or older to use in-game chat.
            </p>
          )}

          <div className='space-y-2'>
            <p className='text-sm font-medium'>What you&apos;re agreeing to</p>
            <ul className='space-y-1 text-xs text-muted-foreground'>
              <li>- We save your Steam display name, hashed identifiers, and match results.</li>
              <li>- We don&apos;t sell your data or use it for ads. Ever.</li>
              <li>- You can delete your account from the account overlay at any time.</li>
            </ul>
          </div>

          <Button variant='outline' className='w-full' asChild>
            <a href='/notice' target='_blank' rel='noreferrer'>View Privacy &amp; Terms Notice</a>
          </Button>

          <div className='flex items-start gap-3'>
            <Checkbox
              id='agreed'
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
            />
            <label htmlFor='agreed' className='text-sm text-muted-foreground leading-relaxed cursor-pointer'>
              I have read and agree to the Privacy &amp; Terms Notice
            </label>
          </div>

          {error && <p className='text-sm text-destructive'>{error}</p>}

          <Button className='w-full' disabled={!canSubmit || submitting} onClick={handleAccept}>
            {submitting ? 'Submitting…' : 'Create Account'}
          </Button>

        </CardContent>
      </Card>
    </div>
  )
}

export default function TosPage() {
  return (
    <Suspense>
      <TosContent />
    </Suspense>
  )
}
