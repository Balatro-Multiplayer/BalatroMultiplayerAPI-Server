'use client'

import { ChevronDown } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MobileMenu } from '@/app/_components/mobile-menu'
import { NavAuth } from '@/app/_components/nav-auth'
import { MotionToggle } from '@/components/motion-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const NAV = [
  { href: '/docs', label: 'Documentation' },
  { href: '/leaderboards', label: 'Leaderboards' },
  { href: '/stats', label: 'Stats' },
  { href: '/support-us', label: 'Support Us' },
]

// In-browser utilities grouped under a Tools dropdown.
const TOOLS = [{ href: '/reskin', label: 'Custom Reskin Studio' }]

// Our own site header — replaces fumadocs' HomeLayout chrome so navigation/theme
// are owned by the app, not the docs framework.
// One source of truth for nav-item styling so links and the Tools trigger match.
const navItemClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm transition-colors ${
    active
      ? 'font-medium text-foreground'
      : 'text-muted-foreground hover:text-foreground'
  }`

export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className='sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur'>
      <div className='container mx-auto flex h-14 items-center gap-4'>
        <Link href='/' className='flex shrink-0 items-center gap-2 font-bold'>
          <Image
            src='/logo.png'
            alt=''
            width={28}
            height={28}
            className='size-7'
            style={{ imageRendering: 'pixelated' }}
          />
          <span className='hidden sm:inline'>Balatro Multiplayer</span>
        </Link>

        <nav className='hidden items-center gap-1 md:flex'>
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={navItemClass(active)}
              >
                {item.label}
              </Link>
            )
          })}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={`${navItemClass(
                TOOLS.some((t) => pathname.startsWith(t.href))
              )} inline-flex items-center gap-1 outline-none`}
            >
              Tools
              <ChevronDown className='size-3.5' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              {TOOLS.map((t) => (
                <DropdownMenuItem key={t.href} asChild>
                  <Link href={t.href}>{t.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        <div className='ml-auto flex items-center gap-1'>
          <div className='hidden items-center gap-1 md:flex'>
            <MotionToggle />
            <NavAuth />
          </div>
          <MobileMenu className='md:hidden' />
        </div>
      </div>
    </header>
  )
}
