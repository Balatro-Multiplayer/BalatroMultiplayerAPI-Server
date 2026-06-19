'use client'

import type { HomeLayoutProps } from 'fumadocs-ui/layouts/home'
import type { LinkItemType } from 'fumadocs-ui/layouts/shared'
import { LogIn, LogOut, Settings, Shield, Tv, User } from 'lucide-react'
import Link from 'next/link'
import { signIn, signOut, useSession } from 'next-auth/react'
import { Fragment, type ReactNode } from 'react'
import { ModeToggle } from '@/components/mode-toggle'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ADMIN_NAV_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
} from '@/lib/permissions'
import {
  Navbar,
  NavbarLink,
  NavbarMenu,
  NavbarMenuContent,
  NavbarMenuLink,
  NavbarMenuTrigger,
} from './home/navbar'
import { MobileMenu } from './mobile-menu'
import { LargeSearchToggle, SearchToggle } from './search-toggle'

function getLinkItemKey(item: LinkItemType): string {
  if ('url' in item && typeof item.url === 'string') {
    return item.url
  }
  if ('text' in item && typeof item.text === 'string') {
    return item.text
  }
  return JSON.stringify(item)
}

function renderThemeSwitch(
  themeSwitch: HomeLayoutProps['themeSwitch'],
  fallback: ReactNode
) {
  if (themeSwitch?.enabled === false) return null
  return themeSwitch?.component ?? fallback
}

export function Header({
  nav = {},
  finalLinks,
  searchToggle,
  themeSwitch,
}: HomeLayoutProps & {
  finalLinks: LinkItemType[]
}) {
  const { data: session, status } = useSession()
  const isAuthenticated = status === 'authenticated'
  const canSeeAdminMenu =
    isAuthenticated && hasAnyPermission(session?.user, ADMIN_NAV_PERMISSIONS)
  const navItems = finalLinks.filter((item) =>
    ['nav', 'all'].includes(item.on ?? 'all')
  )

  return (
    <Navbar>
      <Link
        href={nav.url ?? '/'}
        className='inline-flex items-center gap-2.5 font-semibold'
      >
        {typeof nav.title === 'function' ? <nav.title /> : nav.title}
      </Link>
      {nav.children}
      <ul className='flex flex-row items-center gap-2 px-6 max-md:hidden'>
        {navItems
          .filter((item) => !isSecondary(item))
          .map((item) => (
            <NavbarLinkItem
              key={getLinkItemKey(item)}
              item={item}
              className='text-sm'
            />
          ))}
        {canSeeAdminMenu && (
          <NavbarMenu>
            <NavbarMenuTrigger className='text-sm'>
              <div className='flex items-center gap-1'>
                <Shield className='h-4 w-4' />
                <span>Admin</span>
              </div>
            </NavbarMenuTrigger>
            <NavbarMenuContent>
              {hasPermission(session?.user, 'moderation.view') ? (
                <NavbarMenuLink href='/admin/moderation'>
                  <p className='-mb-1 font-medium text-sm'>Moderation</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Review strikes and bans
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'permissions.manage') ? (
                <NavbarMenuLink href='/admin/permissions'>
                  <p className='-mb-1 font-medium text-sm'>Permissions</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Edit per-user access
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'banned_users.manage') ? (
                <NavbarMenuLink href='/admin/banned-users'>
                  <p className='-mb-1 font-medium text-sm'>Banned Users</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Manage parser aliases and ids
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'seasons.manage') ? (
                <NavbarMenuLink href='/admin/seasons'>
                  <p className='-mb-1 font-medium text-sm'>Seasons</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Manage seasons and snapshots
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'queues.manage') ? (
                <NavbarMenuLink href='/admin/queue-settings'>
                  <p className='-mb-1 font-medium text-sm'>Queue Settings</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    View and edit bot queue config
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'blog.manage') ? (
                <NavbarMenuLink href='/admin/blog'>
                  <p className='-mb-1 font-medium text-sm'>Blog</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Manage blog posts
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'logs.manage') ? (
                <NavbarMenuLink href='/admin/logs'>
                  <p className='-mb-1 font-medium text-sm'>Logs</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    View and manage logs
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'games.view') ? (
                <NavbarMenuLink href='/admin/games'>
                  <p className='-mb-1 font-medium text-sm'>Games</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Browse extracted game rows
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'transcripts.search') ? (
                <NavbarMenuLink href='/admin/lobby-codes'>
                  <p className='-mb-1 font-medium text-sm'>Lobby Codes</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Search lobby codes from transcripts
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'releases.manage') ? (
                <NavbarMenuLink href='/admin/releases'>
                  <p className='-mb-1 font-medium text-sm'>Releases</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Manage releases
                  </p>
                </NavbarMenuLink>
              ) : null}
              {hasPermission(session?.user, 'obs_control.manage') ? (
                <NavbarMenuLink href='/admin/stream/obs-control-panel'>
                  <p className='-mb-1 font-medium text-sm'>OBS Control Panel</p>
                  <p className='text-[13px] text-fd-muted-foreground'>
                    Stream widget controls
                  </p>
                </NavbarMenuLink>
              ) : null}
            </NavbarMenuContent>
          </NavbarMenu>
        )}
      </ul>
      <div className='flex flex-1 flex-row items-center justify-end gap-1.5'>
        {searchToggle?.enabled !== false ? (
          <>
            <SearchToggle className='md:hidden' hideIfDisabled />
            <LargeSearchToggle
              className='w-full max-w-[240px] max-md:hidden'
              hideIfDisabled
            />
          </>
        ) : null}
        {renderThemeSwitch(
          themeSwitch,
          <div className='max-md:hidden'>
            <ModeToggle />
          </div>
        )}

        {/* Sign In Button or User Menu (desktop only, Sheet handles mobile) */}
        <div className='flex items-center max-md:hidden'>
          {isAuthenticated && session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  className='relative h-9 w-9 rounded-full'
                >
                  <Avatar className='h-9 w-9'>
                    <AvatarImage
                      src={session.user.image ?? ''}
                      alt={session.user.name ?? 'User'}
                    />
                    <AvatarFallback className='bg-violet-50 text-violet-600 dark:bg-violet-900/50 dark:text-violet-300'>
                      {session.user.name?.slice(0, 2).toUpperCase() ?? 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className='w-56' align='end' forceMount>
                <div className='flex items-center justify-start gap-2 p-2'>
                  <div className='flex flex-col space-y-1 leading-none'>
                    <p className='font-medium'>{session.user.name}</p>
                  </div>
                </div>
                <DropdownMenuItem asChild>
                  <Link
                    href={`/players/${session.user.discord_id}`}
                    className='flex w-full items-center'
                  >
                    <User className='mr-2 h-4 w-4' />
                    <span>Profile</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href='/profile/settings'
                    className='flex w-full items-center'
                  >
                    <Settings className='mr-2 h-4 w-4' />
                    <span>Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href={`/stream-card/${session.user.discord_id}`}
                    className='flex w-full items-center'
                    target='_blank'
                  >
                    <Tv className='mr-2 h-4 w-4' />
                    <span>Stream Widget</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut className='mr-2 h-4 w-4' />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant='outline'
              size='sm'
              className='text-gray-700 hover:bg-violet-50 hover:text-violet-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-violet-400'
              onClick={() => signIn('discord')}
            >
              <LogIn className='mr-2 h-4 w-4' />
              Sign In
            </Button>
          )}
        </div>
      </div>
      <ul className='flex flex-row items-center'>
        {navItems.filter(isSecondary).map((item) => (
          <NavbarLinkItem
            key={getLinkItemKey(item)}
            item={item}
            className='-me-1.5 max-md:hidden'
          />
        ))}
        <MobileMenu className='md:hidden' themeSwitch={themeSwitch} />
      </ul>
    </Navbar>
  )
}

function NavbarLinkItem({
  item,
  ...props
}: {
  item: LinkItemType
  className?: string
}) {
  if (item.type === 'custom') return <div {...props}>{item.children}</div>

  if (item.type === 'menu') {
    const children = item.items.map((child) => {
      if (child.type === 'custom')
        return <Fragment key={getLinkItemKey(child)}>{child.children}</Fragment>

      const {
        banner = child.icon ? (
          <div className='w-fit rounded-md border bg-fd-muted p-1 [&_svg]:size-4'>
            {child.icon}
          </div>
        ) : null,
        ...rest
      } = child.menu ?? {}

      return (
        <NavbarMenuLink key={getLinkItemKey(child)} href={child.url} {...rest}>
          {rest.children ?? (
            <>
              {banner}
              <p className='-mb-1 font-medium text-sm'>{child.text}</p>
              {child.description ? (
                <p className='text-[13px] text-fd-muted-foreground'>
                  {child.description}
                </p>
              ) : null}
            </>
          )}
        </NavbarMenuLink>
      )
    })

    return (
      <NavbarMenu>
        <NavbarMenuTrigger {...props}>
          {item.url ? <Link href={item.url}>{item.text}</Link> : item.text}
        </NavbarMenuTrigger>
        <NavbarMenuContent>{children}</NavbarMenuContent>
      </NavbarMenu>
    )
  }

  return (
    <NavbarLink
      {...props}
      item={item}
      variant={item.type}
      aria-label={item.type === 'icon' ? item.label : undefined}
    >
      {item.type === 'icon' ? item.icon : item.text}
    </NavbarLink>
  )
}

function isSecondary(item: LinkItemType): boolean {
  return (
    ('secondary' in item && item.secondary === true) || item.type === 'icon'
  )
}
