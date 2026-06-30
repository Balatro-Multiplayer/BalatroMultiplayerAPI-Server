'use client'

import {
  BarChart3,
  BookOpen,
  CircleDollarSign,
  Gamepad2,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  PackageOpen,
  Palette,
  Shield,
  Trophy,
  User,
  Layers,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

function MobileMenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className='flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80'
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
        <div className='flex h-9 w-9 items-center justify-center rounded-full bg-card border border-border text-sm font-bold'>
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
      <MobileMenuLink href='/docs' icon={<BookOpen className='size-4' />} onClick={onClose}>
        Documentation
      </MobileMenuLink>
      <MobileMenuLink href='/leaderboards' icon={<Trophy className='size-4' />} onClick={onClose}>
        Leaderboards
      </MobileMenuLink>
      <MobileMenuLink href='/stats' icon={<BarChart3 className='size-4' />} onClick={onClose}>
        Stats
      </MobileMenuLink>
      <MobileMenuLink href='/support-us' icon={<CircleDollarSign className='size-4' />} onClick={onClose}>
        Support Us
      </MobileMenuLink>
      <MobileMenuLink href='/reskin' icon={<Palette className='size-4' />} onClick={onClose}>
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
        <MobileMenuLink href='/profile' icon={<User className='size-4' />} onClick={onClose}>
          My Account
        </MobileMenuLink>
      </div>
    </>
  )
}

function MobileAdminSection({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Separator />
      <div className='px-3 py-3'>
        <p className='mb-1 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
          <Shield className='mr-1 inline size-3' />
          Admin
        </p>
        <MobileMenuLink href='/admin/users' icon={<Shield className='size-4' />} onClick={onClose}>
          Users &amp; Bans
        </MobileMenuLink>
        <MobileMenuLink href='/admin/logs' icon={<MessageSquare className='size-4' />} onClick={onClose}>
          Chat Logs
        </MobileMenuLink>
        <MobileMenuLink href='/admin/seasons' icon={<Layers className='size-4' />} onClick={onClose}>
          Seasons
        </MobileMenuLink>
        <MobileMenuLink href='/admin/releases' icon={<PackageOpen className='size-4' />} onClick={onClose}>
          Releases
        </MobileMenuLink>
        <MobileMenuLink href='/admin/games' icon={<Gamepad2 className='size-4' />} onClick={onClose}>
          Match History
        </MobileMenuLink>
      </div>
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
        <Button variant='ghost' size='icon' className={className} aria-label='Open menu'>
          <MenuIcon className='size-5' />
        </Button>
      </SheetTrigger>
      <SheetContent side='right' className='w-72 p-0'>
        <SheetTitle className='sr-only'>Navigation menu</SheetTitle>

        <MobileUserHeader player={player} isLoggedIn={isLoggedIn} onClose={close} />

        <div className='min-h-0 flex-1 overflow-y-auto'>
          <MobileNavLinks onClose={close} />
          {isLoggedIn && player && <MobileAccountSection onClose={close} />}
          {(isAdmin || isModerator) && <MobileAdminSection onClose={close} />}
        </div>

        <div className='border-t px-3 py-3'>
          {isLoggedIn && (
            <button
              type='button'
              onClick={() => { close(); logout() }}
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
