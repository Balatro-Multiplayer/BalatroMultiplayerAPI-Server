import type { ReactNode } from 'react'
import { withSiteTitle } from '../../../../../../../lib/metadata'

export const metadata = {
  title: {
    absolute: withSiteTitle('Edit Blog Post'),
  },
}

export default function EditBlogPostLayout({
  children,
}: {
  children: ReactNode
}) {
  return children
}
