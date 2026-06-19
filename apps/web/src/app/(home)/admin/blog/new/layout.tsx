import type { ReactNode } from 'react'
import { withSiteTitle } from '../../../../../../lib/metadata'

export const metadata = {
  title: {
    absolute: withSiteTitle('New Blog Post'),
  },
}

export default function NewBlogPostLayout({
  children,
}: {
  children: ReactNode
}) {
  return children
}
