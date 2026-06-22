'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { setToken } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 121 }, (_, i) => currentYear - i)

function computeAge(month: number, day: number, year: number): number {
  const now = new Date()
  let age = now.getFullYear() - year
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) {
    age -= 1
  }
  return age
}

function TosContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingToken = searchParams.get('token')
  const isUpdate = searchParams.get('update') === '1'

  const [month, setMonth] = useState<number | null>(null)
  const [day, setDay] = useState<number | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dateComplete = month !== null && day !== null && year !== null
  const age = dateComplete ? computeAge(month!, day!, year!) : null
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
      setError(err instanceof Error ? err.message : 'Something went wrong')
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

          {/* Birthday */}
          <div className='space-y-2'>
            <p className='text-sm font-medium'>Your birthday</p>
            <p className='text-xs text-muted-foreground'>
              We won&apos;t store it, we just need to check that you are old enough to play.
            </p>
            <div className='grid grid-cols-3 gap-2'>
              <div className='space-y-1'>
                <Label className='text-xs'>Month</Label>
                <Select onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger><SelectValue placeholder='Month' /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((name, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Day</Label>
                <Select onValueChange={(v) => setDay(Number(v))}>
                  <SelectTrigger><SelectValue placeholder='Day' /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Year</Label>
                <Select onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger><SelectValue placeholder='Year' /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {dateComplete && !chatEligible && (
              <p className='text-xs text-yellow-400'>
                You must be 16 or older to use in-game chat.
              </p>
            )}
          </div>

          {/* Agreement */}
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
