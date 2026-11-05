'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/auth'
import { staffMenuGroups } from '@/lib/staff-menu'
import { useOpenQueueCount } from '@/lib/use-open-queue-count'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment } from 'react'

export function QueueCountBadge({ count }: { count: number | undefined }) {
  if (!count) return null
  return (
    <span className='rounded-full bg-primary px-1.5 py-0.5 font-bold font-pixel text-primary-foreground text-xs leading-none'>
      {count}
    </span>
  )
}

// The "Staff" item of the top nav. Players never see it.
export function StaffMenu({
  itemClass,
}: {
  itemClass: (active: boolean) => string
}) {
  const { isAdmin, isModerator } = useAuth()
  const pathname = usePathname()
  const isStaff = isAdmin || isModerator
  const count = useOpenQueueCount(isStaff)
  const groups = staffMenuGroups({ isAdmin, isModerator })
  if (groups.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${itemClass(pathname.startsWith('/admin'))} inline-flex items-center gap-1.5 outline-none`}
      >
        Staff
        <QueueCountBadge count={count} />
        <ChevronDown className='size-3.5' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-56'>
        {groups.map((group, i) => (
          <Fragment key={group.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className='font-pixel text-muted-foreground text-xs uppercase tracking-wider'>
              {group.label}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} className='flex justify-between gap-3'>
                  {item.label}
                  {item.showsQueueCount && <QueueCountBadge count={count} />}
                </Link>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
