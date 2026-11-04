import { test } from 'bun:test'
import assert from 'node:assert/strict'
import catalog from '../data/catalog.json'
import { sheetPreviewPlan } from './sheetPreviews'
import type { CatalogSheet } from './types'

function sheet(id: string): CatalogSheet {
  const found = catalog.spriteSheets.find((s) => s.id === id)
  assert.ok(found)
  return found as CatalogSheet
}

test('Playing Card Faces resolves its registry key to the complete 923x380 vanilla sheet', () => {
  assert.deepEqual(sheetPreviewPlan(sheet('playing_cards')), {
    path: 'resources/textures/1x/8BitDeck.png',
    cells: [{ id: '0', rect: { x: 0, y: 0, w: 923, h: 380 } }],
  })
})

test('stake chips use their own 29px grid, including the second row', () => {
  const plan = sheetPreviewPlan(sheet('chips'))
  assert.equal(plan.path, 'resources/textures/1x/chips.png')
  assert.equal(plan.cells.length, 10)
  assert.deepEqual(plan.cells[0], {
    id: '0',
    rect: { x: 0, y: 0, w: 29, h: 29 },
  })
  assert.deepEqual(plan.cells[5], {
    id: '5',
    rect: { x: 0, y: 29, w: 29, h: 29 },
  })
  assert.deepEqual(plan.cells[9], {
    id: '9',
    rect: { x: 116, y: 29, w: 29, h: 29 },
  })
})

test('shop sign resolves the on-disk filename and all four horizontal frames', () => {
  const plan = sheetPreviewPlan(sheet('shop_sign'))
  assert.equal(plan.path, 'resources/textures/1x/ShopSignAnimation.png')
  assert.equal(plan.cells.length, 4)
  assert.deepEqual(plan.cells[3], {
    id: '3',
    rect: { x: 339, y: 0, w: 113, h: 57 },
  })
})

test('explicit cell coordinates override row-major placement', () => {
  const original = sheet('chips')
  const plan = sheetPreviewPlan({ ...original, cells: [{ x: 3, y: 1 }] })
  assert.deepEqual(plan.cells[0]?.rect, { x: 87, y: 29, w: 29, h: 29 })
})

test('unnamed grid cells still get original previews', () => {
  const plan = sheetPreviewPlan({ ...sheet('chips'), cells: [] })
  assert.equal(plan.cells.length, 10)
})

test('unknown atlas keys fail explicitly instead of silently using the wrong image', () => {
  assert.throws(
    () => sheetPreviewPlan({ ...sheet('chips'), atlasKey: 'unknown' }),
    /No vanilla atlas mapping/
  )
})
