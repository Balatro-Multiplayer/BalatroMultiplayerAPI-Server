import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { useSearchContext } from 'fumadocs-ui/contexts/search'
import { renderToReadableStream } from 'react-dom/server'
import { FumadocsProvider } from './fumadocs-provider'

function SearchState() {
  const { enabled, open, hotKey } = useSearchContext()
  return (
    <main
      data-search-enabled={enabled}
      data-search-open={open}
      data-search-hotkeys={hotKey.length}
    >
      Reskin Studio
    </main>
  )
}

test('site provider keeps search enabled without streaming an unhydrated search dialog', async () => {
  const errors: unknown[] = []
  // Wait for the full stream: static markup alone can miss the lazy footer.
  const stream = await renderToReadableStream(
    <FumadocsProvider>
      <SearchState />
    </FumadocsProvider>,
    {
      onError: (error) => {
        errors.push(error)
      },
    }
  )
  const html = await new Response(stream).text()
  assert.deepEqual(errors, [])
  assert.ok(html.includes('Reskin Studio'))
  assert.ok(html.includes('data-search-enabled="true"'))
  assert.ok(html.includes('data-search-open="false"'))
  assert.ok(html.includes('data-search-hotkeys="2"'))
  assert.ok(!html.includes('bg-fd-secondary/50'))
  assert.ok(!html.includes('role="dialog"'))
})
