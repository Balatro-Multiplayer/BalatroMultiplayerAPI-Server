import { PageHeader, PageShell } from '@/components/page-kit'
import { createMetadata } from '@/lib/metadata'
import { ReskinStudio } from './studio'

export const metadata = createMetadata({
  title: 'Custom Reskin Studio',
  description:
    'Build a zero-code Balatro reskin and localization pack in your browser, then download a ready-to-install mod.',
  path: '/reskin',
})

export default function ReskinPage() {
  return (
    <PageShell wide>
      <PageHeader
        title='Custom Reskin Studio'
        meta={
          <p className='max-w-2xl'>
            Upload your own art for any joker, card, tag, blind and more, and
            rewrite any in-game text, for any language, without writing code.
            Everything runs in your browser; nothing is uploaded to a server.
            Download a ready-to-install <code>CustomReskin</code> mod, or
            re-import a pack you made earlier to keep editing it.
          </p>
        }
      />
      <ReskinStudio />
    </PageShell>
  )
}
