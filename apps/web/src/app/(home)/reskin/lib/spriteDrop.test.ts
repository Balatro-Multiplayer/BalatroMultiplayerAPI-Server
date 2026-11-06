import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spriteUploadFile, spriteUploadTarget } from './spriteDrop'

const image = (name = 'sprite.png', type = 'image/png') =>
  new File(['synthetic image bytes'], name, { type })

test('sprite upload captures one local image File unchanged for the existing import pipeline', () => {
  for (const file of [
    image(),
    image('sprite.gif', 'image/gif'),
    image('sheet.webp', 'image/webp'),
  ]) {
    assert.equal(spriteUploadFile({ 0: file, length: 1 }), file)
  }
})

test('sprite upload permits recognized image extensions when the browser omits MIME type', () => {
  const file = image('SPRITE.PNG', '')
  assert.equal(spriteUploadFile([file]), file)
})

test('sprite upload rejects links, empty drops, folders, and multiple files without picking the first', () => {
  assert.throws(() => spriteUploadFile([]), /one image file/)
  assert.throws(() => spriteUploadFile([image(), image()]), /one image file/)
  assert.throws(() => spriteUploadFile([new File([], 'folder')]), /image file/)
})

test('sprite upload rejects non-images, misleading extensions with known non-image MIME, and empty files', () => {
  for (const file of [
    image('game.love', 'application/zip'),
    image('not-an-image.png', 'text/plain'),
    image('unknown', ''),
  ]) {
    assert.throws(() => spriteUploadFile([file]), /image file/)
  }
  assert.throws(
    () => spriteUploadFile([new File([], 'empty.png', { type: 'image/png' })]),
    /empty/
  )
})

test('layered drops replace background in combined/background views and only overlay in overlay view', () => {
  assert.equal(spriteUploadTarget(true, 'combined'), 'main')
  assert.equal(spriteUploadTarget(true, 'base'), 'main')
  assert.equal(spriteUploadTarget(true, 'soul'), 'soul')
  for (const layer of ['combined', 'base', 'soul']) {
    assert.equal(spriteUploadTarget(false, layer), 'main')
  }
})
