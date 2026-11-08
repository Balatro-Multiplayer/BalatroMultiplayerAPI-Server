'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { FlowCard, FlowPage } from '@/app/_components/flow-card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ApiError, apiFetch } from '@/lib/api'
import { setToken } from '@/lib/auth'
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
        body: JSON.stringify({
          chatEligible: isUpdate ? undefined : chatEligible,
        }),
      })
      setToken(data.token)
      router.replace('/profile')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Something went wrong'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (blocked) {
    return (
      <FlowPage>
        <FlowCard
          title='Account creation is unavailable'
          intro='You must be 13 or older to play online.'
        />
      </FlowPage>
    )
  }

  if (isUpdate) {
    return (
      <FlowPage>
        <FlowCard
          title='Before you play'
          intro='We updated the Privacy & Terms Notice. Read it, then accept to continue.'
        >
          <Button variant='outline' className='w-full' asChild>
            <a href='/notice' target='_blank' rel='noreferrer'>
              Read the Privacy &amp; Terms Notice
            </a>
          </Button>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <Button
            className='w-full'
            disabled={!canSubmitUpdate || submitting}
            onClick={handleAccept}
          >
            {submitting ? 'Submitting…' : 'I Accept'}
          </Button>
        </FlowCard>
      </FlowPage>
    )
  }

  return (
    <FlowPage>
      <FlowCard
        title='Before you play'
        intro='Two quick steps before you create your account.'
      >
        <BirthdayPicker onAgeChange={setAge} />
        {dateComplete && !chatEligible && (
          <p className='text-xs text-yellow-400'>
            You must be 16 or older to use in-game chat.
          </p>
        )}

        <div className='space-y-2 rounded-md border border-border bg-background/40 p-3'>
          <p className='font-medium text-sm'>What you&apos;re agreeing to</p>
          <ul className='list-disc space-y-1 pl-4 text-muted-foreground text-sm'>
            <li>
              We save your Steam display name, hashed identifiers, match results
              and chat. Chat is checked by a model we run ourselves.
            </li>
            <li>We don&apos;t sell your data or use it for ads. Ever.</li>
            <li>
              You can delete your account from your profile page at any time.
            </li>
          </ul>
        </div>

        <Button variant='outline' className='w-full' asChild>
          <a href='/notice' target='_blank' rel='noreferrer'>
            Read the Privacy &amp; Terms Notice
          </a>
        </Button>

        <div className='flex items-start gap-3'>
          <Checkbox
            id='agreed'
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
          />
          <label
            htmlFor='agreed'
            className='cursor-pointer text-muted-foreground text-sm leading-relaxed'
          >
            I have read and agree to the Privacy &amp; Terms Notice
          </label>
        </div>

        {error && <p className='text-destructive text-sm'>{error}</p>}

        <Button
          className='w-full'
          disabled={!canSubmit || submitting}
          onClick={handleAccept}
        >
          {submitting ? 'Submitting…' : 'Create Account'}
        </Button>
      </FlowCard>
    </FlowPage>
  )
}

export default function TosPage() {
  return (
    <Suspense>
      <TosContent />
    </Suspense>
  )
}
