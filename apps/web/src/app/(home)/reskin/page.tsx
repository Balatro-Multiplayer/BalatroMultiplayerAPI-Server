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
    <div className='mx-auto w-[calc(100%-1rem)] max-w-fd-container py-10'>
      <div className='mb-6'>
        <h1 className='font-bold text-3xl tracking-tight'>
          Custom Reskin Studio
        </h1>
        <p className='mt-2 max-w-2xl text-fd-muted-foreground'>
          Upload your own art for any joker, card, tag, blind and more, and
          rewrite any in-game text, for any language, without writing code.
          Everything runs in your browser; nothing is uploaded to a server.
          Download a ready-to-install <code>CustomReskin</code> mod, or re-import
          a pack you made earlier to keep editing it.
        </p>
      </div>
      <ReskinStudio />
    </div>
  )
}
