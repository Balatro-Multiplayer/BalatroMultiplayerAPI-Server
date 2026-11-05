'use client'

import { LogIn, User } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/auth'

export function NavAuth() {
  const { player, isLoggedIn, logout } = useAuth()

  if (isLoggedIn && player) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='sm' className='gap-1.5 font-pixel text-base'>
            <User className='size-4' />
            <span className='max-sm:hidden'>{player.displayName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem asChild>
            <Link href='/profile'>My Account</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href='/matches'>My Matches</Link>
          </DropdownMenuItem>
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
