import type { Metadata } from 'next'
import { FlowCard, FlowPage } from '@/app/_components/flow-card'

export const metadata: Metadata = {
  title: 'Sign In',
}

const ERRORS: Record<string, string> = {
  link_expired: 'That sign-in link ran out. Sign in again below.',
  no_token: 'Sign-in did not finish. Try again below.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const errorText = error
    ? (ERRORS[error] ?? 'Sign-in failed. Try again below.')
    : null

  const steamLoginUrl = `${process.env.NEXT_PUBLIC_API_BASE ?? '/api/proxy'}/auth/steam/web`

  return (
    <FlowPage>
      <FlowCard
        title='Sign in'
        intro='Connect with Steam to play ranked, see the leaderboards and manage your account.'
      >
        {errorText && (
          <p role='alert' className='text-destructive text-sm'>
            {errorText}
          </p>
        )}
        <a
          href={steamLoginUrl}
          className='flex w-full items-center justify-center gap-3 rounded-md px-4 py-3 font-semibold text-sm transition-colors'
          style={{
            background: '#1b2838',
            color: '#c7d5e0',
            border: '1px solid #2a475e',
          }}
        >
          <SteamIcon />
          Sign in with Steam
        </a>

        <p className='text-center text-muted-foreground text-xs'>
          By signing in, you agree to our{' '}
          <a
            href='/notice'
            className='underline underline-offset-4 hover:text-foreground'
          >
            Privacy &amp; Terms
          </a>
          .
        </p>
      </FlowCard>
    </FlowPage>
  )
}

function SteamIcon() {
  return (
    <svg
      aria-hidden='true'
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      fill='currentColor'
      className='h-5 w-5 shrink-0'
    >
      <path d='M11.979 0C5.678 0 .511 4.86.051 11.021l6.638 2.743a3.127 3.127 0 0 1 1.771-.547l.122-.001 2.952-4.275v-.059a4.457 4.457 0 0 1 4.452-4.452 4.457 4.457 0 0 1 4.452 4.452 4.457 4.457 0 0 1-4.452 4.452h-.103l-4.207 3.001a3.132 3.132 0 0 1-3.12 2.926 3.132 3.132 0 0 1-3.019-2.294L.077 15.87C1.544 20.636 6.396 24 11.979 24 18.626 24 24 18.628 24 11.979 24 5.33 18.626 0 11.979 0' />
    </svg>
  )
}
