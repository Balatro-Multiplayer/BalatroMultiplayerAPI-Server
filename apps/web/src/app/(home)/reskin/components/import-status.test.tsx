import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImportStatus } from './import-status'

const working = {
  state: 'working' as const,
  name: 'Balatro.zip',
  size: 70 * 1024 * 1024,
}

test('import feedback shows the file, stage, elapsed time and cancellation without fabricated percentages', () => {
  const html = renderToStaticMarkup(
    <ImportStatus
      feedback={{ ...working, progress: { stage: 'reading' } }}
      onCancel={() => {}}
    />
  )
  for (const text of [
    'Reading your file',
    'Balatro.zip',
    '70.0 MiB',
    '0s elapsed',
    'Cancel import',
    'not uploading',
    'role="status"',
  ])
    assert.ok(html.includes(text), text)
  assert.ok(!html.includes('<progress'))
})

test('extraction percentage uses reported bytes', () => {
  const html = renderToStaticMarkup(
    <ImportStatus
      feedback={{
        ...working,
        progress: { stage: 'extracting', loaded: 25, total: 100 },
      }}
      onCancel={() => {}}
    />
  )
  assert.ok(html.includes('25% extracted'))
  assert.ok(html.includes('<progress'))
})

test('persistence remains visibly busy without promising cancellable storage', () => {
  const html = renderToStaticMarkup(
    <ImportStatus
      feedback={{ ...working, progress: { stage: 'remembering' } }}
      onCancel={() => {}}
    />
  )
  assert.ok(html.includes('Remembering the archive'))
  assert.ok(!html.includes('Cancel import'))
  assert.ok(html.includes('aria-busy="true"'))
})

test('success, errors and cancellation remain visible after work stops', () => {
  for (const state of ['success', 'error', 'cancelled'] as const) {
    const html = renderToStaticMarkup(
      <ImportStatus
        feedback={{ state, message: `Persistent ${state}` }}
        onCancel={() => {}}
      />
    )
    assert.ok(html.includes(`Persistent ${state}`))
    assert.ok(
      html.includes(state === 'error' ? 'role="alert"' : 'role="status"')
    )
    assert.ok(!html.includes('aria-busy="true"'))
  }
})
