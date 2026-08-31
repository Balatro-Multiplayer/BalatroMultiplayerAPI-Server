// Pixel-approximate preview of how a post's bodyHtml renders inside the
// launcher's own #IntroCardBody card. The launcher renders sanitized
// bodyHtml straight from this API's allowlist (the same source this preview
// consumes), so dangerouslySetInnerHTML is a deliberate, scoped exception
// here -- not a pattern to copy elsewhere in this app.
//
// The 460px width / 398px fold height and 13px font size are provisional
// numbers carried over from the launcher's own QSS card sizing in the
// separate new-launcher repo (not this task's job to change) -- treat this
// as "directionally useful," not pixel-perfect.
const CARD_WIDTH = 460
const FOLD_HEIGHT = 398

export function BlogPreviewCard({ bodyHtml }: { bodyHtml: string }) {
  const isEmpty = !bodyHtml || bodyHtml === '<p></p>'

  return (
    <div className='space-y-2'>
      <p className='text-muted-foreground text-xs'>
        Preview: default-size launcher window
      </p>
      <div
        className='overflow-hidden rounded-md border border-border bg-[#1a1a2e] text-white'
        style={{
          width: CARD_WIDTH,
          fontFamily: 'var(--font-m6x11)',
          fontSize: 13,
        }}
      >
        <div
          style={{ height: FOLD_HEIGHT, overflow: 'hidden' }}
          className='p-4'
        >
          {isEmpty ? (
            <p className='text-white/40'>Nothing to preview yet.</p>
          ) : (
            <div
              className='blog-preview-body'
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized launcher HTML, see file header
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          )}
        </div>
      </div>

      <div className='border-amber-500 border-t-2 border-dashed pt-2'>
        <p className='mb-2 text-amber-500 text-xs'>
          ↓ Won't fit in the launcher card
        </p>
        <div
          className='overflow-hidden rounded-md border border-border bg-[#1a1a2e] text-white opacity-50'
          style={{
            width: CARD_WIDTH,
            fontFamily: 'var(--font-m6x11)',
            fontSize: 13,
          }}
        >
          <div className='p-4'>
            {isEmpty ? null : (
              <div
                className='blog-preview-body'
                // biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized launcher HTML, see file header
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
