import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In',
}

export default function LoginPage() {
  const steamLoginUrl = `${process.env.NEXT_PUBLIC_API_BASE ?? '/api/proxy'}/auth/steam/web`

  return (
    <div className='container flex min-h-[70vh] items-center justify-center py-12'>
      <div className='w-full max-w-sm space-y-8'>
        <div className='space-y-2 text-center'>
          <h1 className='text-2xl font-bold tracking-tight'>Sign In</h1>
          <p className='text-sm text-muted-foreground'>
            Connect with Steam to access ranked play, leaderboards, and your profile.
          </p>
        </div>

        <div className='rounded-lg border border-border bg-card p-6 shadow-sm space-y-6'>
          <a
            href={steamLoginUrl}
            className='flex w-full items-center justify-center gap-3 rounded-md px-4 py-3 text-sm font-semibold transition-colors'
            style={{ background: '#1b2838', color: '#c7d5e0', border: '1px solid #2a475e' }}
          >
            <SteamIcon />
            Sign in with Steam
          </a>

          <p className='text-center text-xs text-muted-foreground'>
            By signing in, you agree to our{' '}
            <a href='/notice' className='underline underline-offset-4 hover:text-foreground'>
              Privacy &amp; Terms
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

function SteamIcon() {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      fill='currentColor'
      className='h-5 w-5 shrink-0'
    >
      <path d='M11.979 0C5.678 0 .511 4.86.051 11.021l6.638 2.743a3.127 3.127 0 0 1 1.771-.547l.122-.001 2.952-4.275v-.059a4.457 4.457 0 0 1 4.452-4.452 4.457 4.457 0 0 1 4.452 4.452 4.457 4.457 0 0 1-4.452 4.452h-.103l-4.207 3.001a3.132 3.132 0 0 1-3.12 2.926 3.132 3.132 0 0 1-3.019-2.294L.077 15.87C1.544 20.636 6.396 24 11.979 24 18.626 24 24 18.628 24 11.979 24 5.33 18.626 0 11.979 0' />
    </svg>
  )
}
