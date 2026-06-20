'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'
import { setToken } from '@/lib/auth'

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <p style={{ color: 'var(--bal-teal-gray)' }}>Signing you in…</p>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  )
}

function AuthCallbackContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const token = searchParams.get('token')
    const error = searchParams.get('error')

    if (error) {
      router.replace(`/login?error=${encodeURIComponent(error)}`)
      return
    }

    if (token) {
      setToken(token)
      const tos = searchParams.get('requireTos')
      if (tos === '1') {
        router.replace('/auth/tos')
      } else {
        router.replace('/profile')
      }
      return
    }

    router.replace('/login?error=no_token')
  }, [searchParams, router])

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--bal-teal-gray)' }}>Signing you in…</p>
    </div>
  )
}
