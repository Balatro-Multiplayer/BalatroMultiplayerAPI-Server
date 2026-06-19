import type { ReactNode } from 'react'
import { createMetadata } from '../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Log Parser',
  description:
    'Parse Balatro Multiplayer logs to inspect matches, shops, vouchers, rerolls, and PvP blinds.',
  path: '/log-parser',
})

export default function LogParserLayout({ children }: { children: ReactNode }) {
  return children
}
