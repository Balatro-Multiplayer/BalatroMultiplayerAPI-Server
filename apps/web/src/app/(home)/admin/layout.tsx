import type { ReactNode } from 'react'
import { createMetadata } from '../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Admin',
  description: 'Internal admin tools for Balatro Multiplayer.',
  path: '/admin',
  noIndex: true,
})

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children
}
