'use client'

import {
  BarChart3,
  CircleDollarSign,
  DownloadIcon,
  History,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  Palette,
  Trophy,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useAuth } from '@/lib/auth'
import { staffMenuGroups } from '@/lib/staff-menu'
import { useOpenQueueCount } from '@/lib/use-open-queue-count'
import { QueueCountBadge } from './staff-menu'

function MobileMenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string
  icon?: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className='flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium font-pixel text-base text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80'
    >
      {icon}
      {children}
    </Link>
  )
}

function MobileUserHeader({
  player,
  isLoggedIn,
  onClose,
}: {
  player: { displayName: string } | null
  isLoggedIn: boolean
  onClose: () => void
}) {
  if (isLoggedIn && player) {
    return (
      <div className='flex items-center gap-3 border-b px-5 pt-14 pb-4'>
        <div className='flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card font-bold text-sm'>
          {player.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className='flex flex-col'>
          <span className='font-semibold text-sm'>{player.displayName}</span>
          <span className='text-muted-foreground text-xs'>Signed in</span>
        </div>
      </div>
    )
  }
  return (
    <div className='border-b px-5 pt-14 pb-4'>
      <Button variant='outline' size='sm' className='w-full' asChild>
        <Link href='/login' onClick={onClose}>
          <LogIn className='mr-2 size-4' />
          Sign In
        </Link>
      </Button>
    </div>
  )
}

function MobileNavLinks({ onClose }: { onClose: () => void }) {
  return (
    <nav className='flex flex-col gap-0.5 px-3 py-3'>
      <MobileMenuLink
        href='/download'
        icon={<DownloadIcon className='size-4' />}
        onClick={onClose}
      >
        Download
      </MobileMenuLink>
      <MobileMenuLink
        href='/leaderboards'
        icon={<Trophy className='size-4' />}
        onClick={onClose}
      >
        Leaderboards
      </MobileMenuLink>
      <MobileMenuLink
        href='/stats'
        icon={<BarChart3 className='size-4' />}
        onClick={onClose}
      >
        Stats
      </MobileMenuLink>
      <MobileMenuLink
        href='/support-us'
        icon={<CircleDollarSign className='size-4' />}
        onClick={onClose}
      >
        Support Us
      </MobileMenuLink>
      <MobileMenuLink
        href='/reskin'
        icon={<Palette className='size-4' />}
        onClick={onClose}
      >
        Custom Reskin Studio
      </MobileMenuLink>
    </nav>
  )
}

function MobileAccountSection({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Separator />
      <div className='px-3 py-3'>
        <p className='mb-1 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
          Account
        </p>
        <MobileMenuLink
          href='/profile'
          icon={<User className='size-4' />}
          onClick={onClose}
        >
          My Account
        </MobileMenuLink>
        <MobileMenuLink
          href='/matches'
          icon={<History className='size-4' />}
          onClick={onClose}
        >
          My Matches
        </MobileMenuLink>
      </div>
    </>
  )
}

function MobileStaffSection({
  onClose,
  isAdmin,
  isModerator,
}: {
  onClose: () => void
  isAdmin: boolean
  isModerator: boolean
}) {
  const count = useOpenQueueCount(true)
  return (
    <>
      {staffMenuGroups({ isAdmin, isModerator }).map((group) => (
        <Fragment key={group.label}>
          <Separator />
          <div className='px-3 py-3'>
            <p className='mb-1 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
              Staff: {group.label}
            </p>
            {group.items.map((item) => (
              <MobileMenuLink key={item.href} href={item.href} onClick={onClose}>
                {item.label}
                {item.showsQueueCount && <QueueCountBadge count={count} />}
              </MobileMenuLink>
            ))}
          </div>
        </Fragment>
      ))}
    </>
  )
}

export function MobileMenu({ className }: { className?: string }) {
  const { player, isLoggedIn, isAdmin, isModerator, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className={className}
          aria-label='Open menu'
        >
          <MenuIcon className='size-5' />
        </Button>
      </SheetTrigger>
      <SheetContent side='right' className='w-72 p-0'>
        <SheetTitle className='sr-only'>Navigation menu</SheetTitle>

        <MobileUserHeader
          player={player}
          isLoggedIn={isLoggedIn}
          onClose={close}
        />

        <div className='min-h-0 flex-1 overflow-y-auto'>
          <MobileNavLinks onClose={close} />
          {isLoggedIn && player && <MobileAccountSection onClose={close} />}
          {(isAdmin || isModerator) && (
            <MobileStaffSection
              onClose={close}
              isAdmin={isAdmin}
              isModerator={isModerator}
            />
          )}
        </div>

        <div className='border-t px-3 py-3'>
          {isLoggedIn && (
            <button
              type='button'
              onClick={() => {
                close()
                logout()
              }}
              className='flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-destructive text-sm transition-colors hover:bg-destructive/10 active:bg-destructive/20'
            >
              <LogOut className='size-4' />
              Sign out
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
