import { DocsLayout } from 'fumadocs-ui/layouts/notebook'
import type { ReactNode } from 'react'
import { baseOptions } from '@/app/layout.config'
import { source } from '../../../lib/source'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      {...baseOptions}
      tree={source.pageTree}
      containerProps={{
        className: 'overflow-x-visible',
        style: {
          gridTemplate: `"sidebar header header"
            "sidebar toc-popover toc-popover"
            "sidebar main toc" 1fr / var(--fd-sidebar-col) minmax(0, calc(100% - var(--fd-sidebar-col) - var(--fd-toc-width))) var(--fd-toc-width)`,
        },
      }}
    >
      {children}
    </DocsLayout>
  )
}
