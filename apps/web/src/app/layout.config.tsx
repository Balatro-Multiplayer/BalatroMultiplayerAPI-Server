import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared'
import {
  BarChart3,
  BookOpen,
  CircleDollarSign,
  Palette,
  Trophy,
  Wrench,
} from 'lucide-react'
import Image from 'next/image'
import { MotionToggle } from '@/components/motion-toggle'
import { NavAuth } from './_components/nav-auth'

const links = [
  { text: 'Documentation', url: '/docs', icon: <BookOpen /> },
  { text: 'Leaderboards', url: '/leaderboards', icon: <Trophy /> },
  { text: 'Stats', url: '/stats', icon: <BarChart3 /> },
  {
    text: 'Tools',
    type: 'menu' as const,
    icon: <Wrench />,
    items: [
      {
        text: 'Custom Reskin Studio',
        url: '/reskin',
        icon: <Palette />,
      },
    ],
  },
  { text: 'Support Us', url: '/support-us', icon: <CircleDollarSign /> },
  {
    type: 'custom' as const,
    secondary: true,
    children: <MotionToggle />,
  },
  {
    type: 'custom' as const,
    secondary: true,
    children: <NavAuth />,
  },
] satisfies LinkItemType[]

export const baseOptions: BaseLayoutProps = {
  links,
  // No site search — hide the search bar in the header.
  searchToggle: { enabled: false },
  nav: {
    title: (
      <div className='flex items-center space-x-2'>
        <Image
          src='/logo.png'
          alt='Balatro Multiplayer'
          width={32}
          height={32}
          className='size-8'
          style={{ imageRendering: 'pixelated' }}
        />
        <span className='inline-block font-bold text-foreground'>Balatro Multiplayer</span>
      </div>
    ),
  },
}
