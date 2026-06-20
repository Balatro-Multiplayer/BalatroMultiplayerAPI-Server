'use client'

import type { HomeLayoutProps } from 'fumadocs-ui/layouts/home'
import type { LinkItemType } from 'fumadocs-ui/layouts/shared'
import { LogIn, LogOut, Shield, User } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Navbar,
  NavbarLink,
  NavbarMenu,
  NavbarMenuContent,
  NavbarMenuLink,
  NavbarMenuTrigger,
} from './home/navbar'
import { MobileMenu } from './mobile-menu'

function getLinkItemKey(item: LinkItemType): string {
  if ('url' in item && typeof item.url === 'string') return item.url
  if ('text' in item && typeof item.text === 'string') return item.text
  return JSON.stringify(item)
}

export function Header({
  nav = {},
  finalLinks,
}: HomeLayoutProps & { finalLinks: LinkItemType[] }) {
  const { player, isLoggedIn, isAdmin, isModerator, logout } = useAuth()

  const navItems = finalLinks.filter((item) =>
    ['nav', 'all'].includes((item as { on?: string }).on ?? 'all')
  )

  return (
    <Navbar>
      <Link href={nav.url ?? '/'} className='inline-flex items-center gap-2.5 font-semibold'>
        {typeof nav.title === 'function' ? <nav.title /> : nav.title}
      </Link>
      {nav.children}

      <ul className='flex flex-row items-center gap-2 px-6 max-md:hidden'>
        {navItems.filter((item) => !isSecondary(item)).map((item) => (
          <NavbarLinkItem key={getLinkItemKey(item)} item={item} className='text-sm' />
        ))}

        {(isAdmin || isModerator) && (
          <NavbarMenu>
            <NavbarMenuTrigger className='text-sm'>
              <div className='flex items-center gap-1'>
                <Shield className='h-4 w-4' />
                <span>Admin</span>
              </div>
            </NavbarMenuTrigger>
            <NavbarMenuContent>
              <NavbarMenuLink href='/admin/users'>
                <p className='-mb-1 font-medium text-sm'>Users</p>
                <p className='text-[13px] text-fd-muted-foreground'>Manage players and bans</p>
              </NavbarMenuLink>
              <NavbarMenuLink href='/admin/logs'>
                <p className='-mb-1 font-medium text-sm'>Logs</p>
                <p className='text-[13px] text-fd-muted-foreground'>View and manage chat logs</p>
              </NavbarMenuLink>
            </NavbarMenuContent>
          </NavbarMenu>
        )}
      </ul>

      <div className='flex flex-1 flex-row items-center justify-end gap-1.5'>
        <div className='flex items-center max-md:hidden'>
          {isLoggedIn && player ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' className='relative h-9 gap-2 px-3 text-sm'>
                  <div className='flex h-6 w-6 items-center justify-center rounded-full bg-card border border-border text-xs font-bold'>
                    {player.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  {player.displayName}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className='w-48' align='end'>
                <DropdownMenuItem asChild>
                  <Link href='/profile' className='flex w-full items-center'>
                    <User className='mr-2 h-4 w-4' />
                    My Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout} className='text-destructive focus:text-destructive'>
                  <LogOut className='mr-2 h-4 w-4' />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant='outline' size='sm' asChild>
              <Link href='/login'>
                <LogIn className='mr-2 h-4 w-4' />
                Sign In
              </Link>
            </Button>
          )}
        </div>
      </div>

      <ul className='flex flex-row items-center'>
        {navItems.filter(isSecondary).map((item) => (
          <NavbarLinkItem key={getLinkItemKey(item)} item={item} className='-me-1.5 max-md:hidden' />
        ))}
        <MobileMenu className='md:hidden' />
      </ul>
    </Navbar>
  )
}

function NavbarLinkItem({ item, ...props }: { item: LinkItemType; className?: string }) {
  if (item.type === 'custom') return <div {...props}>{item.children}</div>

  if (item.type === 'menu') {
    const children = item.items.map((child) => {
      if (child.type === 'custom')
        return <Fragment key={getLinkItemKey(child)}>{child.children}</Fragment>
      return (
        <NavbarMenuLink key={getLinkItemKey(child)} href={child.url}>
          <p className='-mb-1 font-medium text-sm'>{child.text}</p>
          {child.description && (
            <p className='text-[13px] text-fd-muted-foreground'>{child.description}</p>
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
    <NavbarLink {...props} item={item} variant={item.type} aria-label={item.type === 'icon' ? item.label : undefined}>
      {item.type === 'icon' ? item.icon : item.text}
    </NavbarLink>
  )
}

function isSecondary(item: LinkItemType): boolean {
  return ('secondary' in item && item.secondary === true) || item.type === 'icon'
}
