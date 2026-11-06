import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpritePreview } from './sprite-preview'
import { UploadTile } from './upload-tile'

const originals = {
  label: 'Caino',
  defaultPreview: 'data:image/png;base64,YmFzZQ==',
  defaultOverlay: 'data:image/png;base64,c291bA==',
}
const replacement = 'data:image/png;base64,bmV3'

test('combined preview draws original background then original portrait without marking uploads', () => {
  const html = renderToStaticMarkup(<SpritePreview {...originals} />)
  assert.ok(html.includes('Caino background (original)'))
  assert.ok(html.includes('Caino overlay (original)'))
  assert.ok(
    html.indexOf(`src="${originals.defaultPreview}"`) <
      html.indexOf(`src="${originals.defaultOverlay}"`)
  )
  assert.equal((html.match(/opacity-40/g) ?? []).length, 2)
  assert.equal((html.match(/draggable="false"/g) ?? []).length, 2)
})

test('replacing either layer independently keeps the other original', () => {
  const base = renderToStaticMarkup(
    <SpritePreview {...originals} preview={replacement} />
  )
  assert.ok(base.includes('src="' + replacement + '"'))
  assert.ok(base.includes('Caino overlay (original)'))
  assert.ok(!base.includes('Caino background (original)'))
  const soul = renderToStaticMarkup(
    <SpritePreview {...originals} overlay={replacement} />
  )
  assert.ok(soul.includes('Caino background (original)'))
  assert.ok(!soul.includes('Caino overlay (original)'))
  assert.equal((soul.match(/opacity-40/g) ?? []).length, 1)
})

test('layer selection isolates background or overlay and explicit hiding suppresses both overlay sources', () => {
  const base = renderToStaticMarkup(
    <SpritePreview {...originals} layer='base' />
  )
  assert.ok(base.includes('Caino background'))
  assert.ok(!base.includes('Caino overlay'))
  const soul = renderToStaticMarkup(
    <SpritePreview {...originals} layer='soul' />
  )
  assert.ok(!soul.includes('Caino background'))
  assert.ok(soul.includes('Caino overlay'))
  const hidden = renderToStaticMarkup(
    <SpritePreview {...originals} overlay={replacement} overlayHidden />
  )
  assert.ok(hidden.includes('Caino background'))
  assert.ok(!hidden.includes('Caino overlay'))
})

test('viewing original layers is not an edit, while overlay-only and hidden-overlay edits can be cleared', () => {
  const props = { ...originals, onOpen() {}, onClear() {} }
  const original = renderToStaticMarkup(<UploadTile {...props} />)
  assert.ok(original.includes('border-dashed'))
  assert.ok(!original.includes('title="Clear"'))
  for (const edit of [{ overlay: replacement }, { overlayHidden: true }]) {
    const html = renderToStaticMarkup(<UploadTile {...props} {...edit} />)
    assert.ok(html.includes('title="Clear"'))
    assert.ok(!html.includes('border-dashed'))
  }
})
