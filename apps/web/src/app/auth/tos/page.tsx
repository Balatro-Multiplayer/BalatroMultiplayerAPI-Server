'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function TosPage() {
  const router = useRouter()
  const [dob, setDob] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const age = dob
    ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const chatEligible = age !== null && age >= 16

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed || !dob) return
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch('/auth/accept-tos', {
        method: 'POST',
        body: JSON.stringify({ dateOfBirth: dob }),
      })
      router.replace('/profile')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Terms of Service</CardTitle>
          <CardDescription>
            Before playing, please confirm your age and agree to our{' '}
            <a href='/notice' className='underline underline-offset-4 hover:text-foreground'>
              Terms of Service
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className='space-y-6'>
            <div className='space-y-2'>
              <Label htmlFor='dob'>Date of Birth</Label>
              <Input
                id='dob'
                type='date'
                required
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
              {dob && !chatEligible && (
                <p className='text-xs text-yellow-400'>
                  You must be 16 or older to use in-game chat.
                </p>
              )}
            </div>

            <div className='flex items-start gap-3'>
              <Checkbox
                id='agreed'
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
              />
              <label htmlFor='agreed' className='text-sm text-muted-foreground leading-relaxed cursor-pointer'>
                I agree to the{' '}
                <a href='/notice' className='underline underline-offset-4 hover:text-foreground'>
                  Terms of Service and Privacy Policy
                </a>
                {' '}and confirm I am at least 13 years of age.
              </label>
            </div>

            {error && <p className='text-sm text-destructive'>{error}</p>}

            <Button type='submit' className='w-full' disabled={!agreed || !dob || submitting}>
              {submitting ? 'Submitting…' : 'Accept & Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
