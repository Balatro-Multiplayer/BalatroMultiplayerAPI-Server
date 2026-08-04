'use client'

import { LogIn, Shield, User } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/auth'

export function NavAuth() {
  const { player, isLoggedIn, isAdmin, isModerator, logout } = useAuth()

  if (isLoggedIn && player) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='sm' className='gap-1.5 text-sm'>
            <User className='size-4' />
            <span className='max-sm:hidden'>{player.displayName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem asChild>
            <Link href='/profile'>My Account</Link>
          </DropdownMenuItem>
          {(isAdmin || isModerator) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                <Shield className='size-3.5' />
                Admin
              </DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href='/admin/users'>Users &amp; Bans</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href='/admin/logs'>Chat Logs</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href='/admin/seasons'>Seasons</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href='/admin/releases'>Releases</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href='/admin/games'>Match History</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href='/admin/config'>Configuration</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href='/admin/ranked-mods'>Ranked Mods</Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={logout}
            className='text-destructive focus:text-destructive'
          >
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Button variant='outline' size='sm' asChild>
      <Link href='/login'>
        <LogIn className='mr-1.5 size-4' />
        Sign In
      </Link>
    </Button>
  )
}
