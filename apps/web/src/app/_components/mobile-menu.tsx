'use client'

import {
  BarChart3,
  CircleDollarSign,
  DoorOpen,
  DownloadIcon,
  Gamepad2,
  History,
  Layers,
  ListChecks,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  Newspaper,
  PackageOpen,
  Palette,
  Puzzle,
  Settings,
  Shield,
  Trophy,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useAuth } from '@/lib/auth'

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

function MobileAdminSection({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Separator />
      <div className='px-3 py-3'>
        <p className='mb-1 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
          <Shield className='mr-1 inline size-3' />
          Admin
        </p>
        <MobileMenuLink
          href='/admin/users'
          icon={<Shield className='size-4' />}
          onClick={onClose}
        >
          Users &amp; Bans
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/service-queue'
          icon={<ListChecks className='size-4' />}
          onClick={onClose}
        >
          Service Queue
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/lobbies'
          icon={<DoorOpen className='size-4' />}
          onClick={onClose}
        >
          Lobbies
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/logs'
          icon={<MessageSquare className='size-4' />}
          onClick={onClose}
        >
          Chat Logs
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/seasons'
          icon={<Layers className='size-4' />}
          onClick={onClose}
        >
          Seasons
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/releases'
          icon={<PackageOpen className='size-4' />}
          onClick={onClose}
        >
          BET Releases
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/blog'
          icon={<Newspaper className='size-4' />}
          onClick={onClose}
        >
          Blog
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/games'
          icon={<Gamepad2 className='size-4' />}
          onClick={onClose}
        >
          Match History
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/config'
          icon={<Settings className='size-4' />}
          onClick={onClose}
        >
          Configuration
        </MobileMenuLink>
        <MobileMenuLink
          href='/admin/ranked-mods'
          icon={<Puzzle className='size-4' />}
          onClick={onClose}
        >
          Ranked Mods
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
          {(isAdmin || isModerator) && <MobileAdminSection onClose={close} />}
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
