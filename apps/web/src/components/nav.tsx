'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAuth } from '@/lib/auth'

const NAV_LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/leaderboards', label: 'Leaderboard' },
  { href: '/stats', label: 'Stats' },
  { href: '/support-us', label: 'Support Us' },
]

export function Nav() {
  const { player, isLoggedIn, isAdmin, isModerator, logout } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  function closeMobile() {
    setMobileOpen(false)
  }

  const showAdmin = isAdmin || isModerator

  return (
    <nav style={NAV_STYLE}>
      <Link href='/' style={BRAND_STYLE} onClick={closeMobile}>
        <Image
          src='/logo.png'
          alt='Balatro Multiplayer'
          width={32}
          height={32}
          style={{ imageRendering: 'pixelated' }}
        />
        <span>Balatro Multiplayer</span>
      </Link>

      {/* Desktop links */}
      <div style={LINKS_STYLE}>
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            style={{
              ...LINK_STYLE,
              ...(pathname?.startsWith(href) ? LINK_ACTIVE_STYLE : {}),
            }}
          >
            {label}
          </Link>
        ))}
        {showAdmin && (
          <Link
            href='/admin/users'
            style={{ ...LINK_STYLE, color: 'var(--bal-coral)' }}
          >
            Admin
          </Link>
        )}
        {isLoggedIn ? (
          <>
            <Link
              href='/profile'
              style={{
                ...LINK_STYLE,
                ...(pathname === '/profile' ? LINK_ACTIVE_STYLE : {}),
              }}
            >
              Account
            </Link>
            <button
              type='button'
              style={AVATAR_BTN_STYLE}
              onClick={() => logout()}
            >
              <span style={{ color: 'var(--bal-cream)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>
                {player?.displayName}
              </span>
              <span style={{ color: 'var(--bal-gray-mid)', fontSize: 9, fontFamily: 'inherit' }}>
                Sign out
              </span>
            </button>
          </>
        ) : (
          <Link href='/login' style={SIGN_IN_BTN_STYLE}>
            Sign In
          </Link>
        )}
      </div>

      {/* Mobile hamburger */}
      <button
        type='button'
        aria-label='Toggle menu'
        style={HAMBURGER_STYLE}
        onClick={() => setMobileOpen((o) => !o)}
      >
        <span style={BAR_STYLE} />
        <span style={BAR_STYLE} />
        <span style={BAR_STYLE} />
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div style={DRAWER_STYLE}>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={MOBILE_LINK_STYLE}
              onClick={closeMobile}
            >
              {label}
            </Link>
          ))}
          {showAdmin && (
            <Link
              href='/admin/users'
              style={{ ...MOBILE_LINK_STYLE, color: 'var(--bal-coral)' }}
              onClick={closeMobile}
            >
              Admin
            </Link>
          )}
          {isLoggedIn && (
            <Link
              href='/profile'
              style={MOBILE_LINK_STYLE}
              onClick={closeMobile}
            >
              Account
            </Link>
          )}
          <div style={{ marginTop: 16 }}>
            {isLoggedIn ? (
              <button
                type='button'
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--bal-coral)',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={() => { logout(); closeMobile() }}
              >
                Sign out ({player?.displayName})
              </button>
            ) : (
              <Link
                href='/login'
                style={SIGN_IN_BTN_STYLE}
                onClick={closeMobile}
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}

const NAV_STYLE: React.CSSProperties = {
  position: 'relative',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 32px',
  borderBottom: '2px solid rgba(0,0,0,0.25)',
  background: 'rgba(0,0,0,0.2)',
  backdropFilter: 'blur(4px)',
}

const BRAND_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  color: 'var(--bal-cream)',
  fontSize: 15,
  fontWeight: 700,
  textShadow: '2px 2px 0 rgba(0,0,0,0.4)',
  textDecoration: 'none',
}

const LINKS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 20,
}

const LINK_STYLE: React.CSSProperties = {
  color: 'var(--bal-teal-gray)',
  fontSize: 13,
  fontWeight: 700,
  textDecoration: 'none',
  transition: 'color 0.1s',
}

const LINK_ACTIVE_STYLE: React.CSSProperties = {
  color: 'var(--bal-white)',
}

const AVATAR_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
}

const SIGN_IN_BTN_STYLE: React.CSSProperties = {
  background: 'var(--bal-coral)',
  color: 'var(--bal-white)',
  border: 'none',
  borderRadius: 999,
  padding: '8px 16px',
  fontSize: 11,
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  textDecoration: 'none',
  boxShadow: '0 3px 0 var(--bal-red-dark), 0 4px 8px rgba(0,0,0,0.25)',
}

const HAMBURGER_STYLE: React.CSSProperties = {
  display: 'none',
  flexDirection: 'column',
  gap: 5,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 6,
}

const BAR_STYLE: React.CSSProperties = {
  display: 'block',
  width: 22,
  height: 2,
  background: 'var(--bal-teal-gray)',
}

const DRAWER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 50,
  background: 'var(--bal-panel-dark)',
  borderBottom: '2px solid rgba(0,0,0,0.3)',
  display: 'flex',
  flexDirection: 'column',
  padding: '16px 24px 24px',
  gap: 4,
}

const MOBILE_LINK_STYLE: React.CSSProperties = {
  color: 'var(--bal-teal-gray)',
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 0',
  borderBottom: '1px solid rgba(0,0,0,0.2)',
  textDecoration: 'none',
}
