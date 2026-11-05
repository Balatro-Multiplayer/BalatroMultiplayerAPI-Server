'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'
import { apiFetch } from '@/lib/api'
import { setToken } from '@/lib/auth'

type LinkLogin = { token?: string; tosToken?: string; path: string }

// A page of this site only: the server checks it, this guards the redirect too.
function sitePath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? path : '/profile'
}

export default function AuthLinkPage() {
  return (
    <Suspense fallback={<Message text='Signing you in…' />}>
      <AuthLinkContent />
    </Suspense>
  )
}

function AuthLinkContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const code = searchParams.get('code')
    if (!code) {
      router.replace('/login?error=link_expired')
      return
    }

    apiFetch<LinkLogin>('/auth/link-login', { method: 'POST', body: JSON.stringify({ code }) })
      .then((login) => {
        if (login.token) {
          setToken(login.token)
          router.replace(sitePath(login.path))
        } else if (login.tosToken) {
          router.replace(`/auth/tos?token=${encodeURIComponent(login.tosToken)}`)
        } else {
          router.replace('/login?error=link_expired')
        }
      })
      .catch(() => router.replace('/login?error=link_expired'))
  }, [searchParams, router])

  return <Message text='Signing you in…' />
}

function Message({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--bal-teal-gray)' }}>{text}</p>
    </div>
  )
}
