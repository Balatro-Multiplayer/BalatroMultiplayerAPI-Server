'use client'

import type { HomeLayoutProps } from 'fumadocs-ui/layouts/home'
import {
  BarChart3,
  BookOpen,
  CircleDollarSign,
  FileText,
  Flag,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  Settings,
  Shield,
  Trophy,
  Tv,
  Upload,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { signIn, signOut, useSession } from 'next-auth/react'
import { type ReactNode, useState } from 'react'
import { ModeToggle } from '@/components/mode-toggle'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  ADMIN_NAV_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
} from '@/lib/permissions'

function renderThemeSwitch(
  themeSwitch: HomeLayoutProps['themeSwitch'],
  fallback: ReactNode
) {
  if (themeSwitch?.enabled === false) return null
  return themeSwitch?.component ?? fallback
}

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
      className='flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-fd-muted-foreground text-sm transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground active:bg-fd-accent/80'
    >
      {icon}
      {children}
    </Link>
  )
}

export function MobileMenu({
  themeSwitch,
  className,
}: {
  themeSwitch?: HomeLayoutProps['themeSwitch']
  className?: string
}) {
  const { data: session, status } = useSession()
  const isAuthenticated = status === 'authenticated'
  const canSeeAdminMenu =
    isAuthenticated && hasAnyPermission(session?.user, ADMIN_NAV_PERMISSIONS)
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

        {/* User section */}
        {isAuthenticated && session?.user ? (
          <div className='flex items-center gap-3 border-b px-5 pt-14 pb-4'>
            <Avatar className='size-9'>
              <AvatarImage
                src={session.user.image ?? ''}
                alt={session.user.name ?? 'User'}
              />
              <AvatarFallback className='bg-violet-50 text-violet-600 dark:bg-violet-900/50 dark:text-violet-300'>
                {session.user.name?.slice(0, 2).toUpperCase() ?? 'U'}
              </AvatarFallback>
            </Avatar>
            <div className='flex flex-col'>
              <span className='font-semibold text-sm'>{session.user.name}</span>
              <span className='text-fd-muted-foreground text-xs'>
                Signed in
              </span>
            </div>
          </div>
        ) : (
          <div className='border-b px-5 pt-14 pb-4'>
            <Button
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => {
                close()
                signIn('discord')
              }}
            >
              <LogIn className='mr-2 size-4' />
              Sign in with Discord
            </Button>
          </div>
        )}

        {/* Navigation */}
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <nav className='flex flex-col gap-0.5 px-3 py-3'>
            <MobileMenuLink
              href='/docs'
              icon={<BookOpen className='size-4' />}
              onClick={close}
            >
              Documentation
            </MobileMenuLink>
            <MobileMenuLink
              href='/leaderboards'
              icon={<Trophy className='size-4' />}
              onClick={close}
            >
              Leaderboards
            </MobileMenuLink>
            <MobileMenuLink
              href='/support-us'
              icon={<CircleDollarSign className='size-4' />}
              onClick={close}
            >
              Support Us
            </MobileMenuLink>
            <MobileMenuLink
              href='/stats'
              icon={<BarChart3 className='size-4' />}
              onClick={close}
            >
              Stats
            </MobileMenuLink>
            <MobileMenuLink
              href='/blog'
              icon={<FileText className='size-4' />}
              onClick={close}
            >
              Blog
            </MobileMenuLink>
          </nav>

          <Separator />

          {/* Tools */}
          <div className='px-3 py-3'>
            <p className='mb-1 px-3 font-semibold text-fd-muted-foreground text-xs uppercase tracking-wider'>
              Tools
            </p>
            <MobileMenuLink
              href='/profile-fix'
              icon={<Upload className='size-4' />}
              onClick={close}
            >
              Fix Corrupted Profile
            </MobileMenuLink>
            <MobileMenuLink
              href='/log-parser'
              icon={<FileText className='size-4' />}
              onClick={close}
            >
              Log Parser
            </MobileMenuLink>
          </div>

          {/* User links */}
          {isAuthenticated && session?.user && (
            <>
              <Separator />
              <div className='px-3 py-3'>
                <p className='mb-1 px-3 font-semibold text-fd-muted-foreground text-xs uppercase tracking-wider'>
                  Account
                </p>
                <MobileMenuLink
                  href={`/players/${session.user.discord_id}`}
                  icon={<User className='size-4' />}
                  onClick={close}
                >
                  Profile
                </MobileMenuLink>
                <MobileMenuLink
                  href='/profile/settings'
                  icon={<Settings className='size-4' />}
                  onClick={close}
                >
                  Settings
                </MobileMenuLink>
                <MobileMenuLink
                  href={`/stream-card/${session.user.discord_id}`}
                  icon={<Tv className='size-4' />}
                  onClick={close}
                >
                  Stream Widget
                </MobileMenuLink>
              </div>
            </>
          )}

          {/* Admin */}
          {canSeeAdminMenu && (
            <>
              <Separator />
              <div className='px-3 py-3'>
                <p className='mb-1 px-3 font-semibold text-fd-muted-foreground text-xs uppercase tracking-wider'>
                  <Shield className='mr-1 inline size-3' />
                  Admin
                </p>
                {hasPermission(session?.user, 'moderation.view') ? (
                  <MobileMenuLink
                    href='/admin/moderation'
                    icon={<Flag className='size-4' />}
                    onClick={close}
                  >
                    Moderation
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'permissions.manage') ? (
                  <MobileMenuLink
                    href='/admin/permissions'
                    icon={<Shield className='size-4' />}
                    onClick={close}
                  >
                    Permissions
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'banned_users.manage') ? (
                  <MobileMenuLink
                    href='/admin/banned-users'
                    icon={<Shield className='size-4' />}
                    onClick={close}
                  >
                    Banned Users
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'seasons.manage') ? (
                  <MobileMenuLink
                    href='/admin/seasons'
                    icon={<Settings className='size-4' />}
                    onClick={close}
                  >
                    Seasons
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'queues.manage') ? (
                  <MobileMenuLink
                    href='/admin/queue-settings'
                    icon={<Settings className='size-4' />}
                    onClick={close}
                  >
                    Queue Settings
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'blog.manage') ? (
                  <MobileMenuLink
                    href='/admin/blog'
                    icon={<FileText className='size-4' />}
                    onClick={close}
                  >
                    Blog
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'logs.manage') ? (
                  <MobileMenuLink
                    href='/admin/logs'
                    icon={<FileText className='size-4' />}
                    onClick={close}
                  >
                    Logs
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'games.view') ? (
                  <MobileMenuLink
                    href='/admin/games'
                    icon={<Trophy className='size-4' />}
                    onClick={close}
                  >
                    Games
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'transcripts.search') ? (
                  <MobileMenuLink
                    href='/admin/lobby-codes'
                    icon={<FileText className='size-4' />}
                    onClick={close}
                  >
                    Lobby Codes
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'releases.manage') ? (
                  <MobileMenuLink
                    href='/admin/releases'
                    icon={<FileText className='size-4' />}
                    onClick={close}
                  >
                    Releases
                  </MobileMenuLink>
                ) : null}
                {hasPermission(session?.user, 'obs_control.manage') ? (
                  <MobileMenuLink
                    href='/admin/stream/obs-control-panel'
                    icon={<Tv className='size-4' />}
                    onClick={close}
                  >
                    OBS Control Panel
                  </MobileMenuLink>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div className='border-t px-3 py-3'>
          <div className='flex items-center justify-between px-3'>
            <span className='text-fd-muted-foreground text-xs'>Theme</span>
            {renderThemeSwitch(themeSwitch, <ModeToggle />)}
          </div>
          {isAuthenticated && (
            <button
              type='button'
              onClick={() => {
                close()
                signOut()
              }}
              className='mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-destructive text-sm transition-colors hover:bg-destructive/10 active:bg-destructive/20'
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
