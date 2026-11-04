import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpriteDropZone } from './sprite-drop-zone'

function markup(disabled: boolean, target: 'image' | 'background' | 'overlay') {
  return renderToStaticMarkup(
    <SpriteDropZone
      disabled={disabled}
      target={target}
      style={{ width: 213, maxWidth: '100%' }}
      onFile={() => {}}
      onError={() => {}}
    >
      <span>Original preview</span>
    </SpriteDropZone>
  )
}

test('sprite drop target preserves preview and exposes the actual layer replacement hint', () => {
  for (const target of ['image', 'background', 'overlay'] as const) {
    const html = markup(false, target)
    assert.ok(html.includes('Original preview'))
    assert.ok(html.includes(`aria-label="Drop a replacement ${target}"`))
    assert.ok(html.includes(`replace the ${target}.`))
    assert.ok(html.includes('aria-disabled="false"'))
    assert.ok(html.includes('max-width:100%'))
  }
})

test('busy drop target shows processing instead of inviting another replacement', () => {
  const html = markup(true, 'image')
  assert.ok(html.includes('aria-disabled="true"'))
  assert.ok(html.includes('aria-busy="true"'))
  assert.ok(html.includes('Processing image…'))
  assert.ok(!html.includes('onto the preview'))
})
