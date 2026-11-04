import { test } from 'bun:test'
import assert from 'node:assert/strict'
import catalogData from '../data/catalog.json'
import { GameArchive } from './gameArchive'
import { loadObjectPreviews, objectPreviewPlan } from './objectPreviews'
import type { Catalog } from './types'
import { createZip, zipText } from './zip'

const catalog = catalogData as Catalog
const category = (id: string) => {
  const found = catalog.spriteCategories.find((c) => c.id === id)
  assert.ok(found)
  return found
}

test('preview loads share an in-flight promise but never cross archive identities', async () => {
  const emptyCatalog: Catalog = { ...catalog, spriteObjects: {} }
  const bytes = createZip([{ name: 'main.lua', data: zipText('-- synthetic') }])
  const first = new GameArchive(bytes)
  const second = new GameArchive(bytes.slice())
  const cat = category('Joker')
  const pending = loadObjectPreviews(first, emptyCatalog, cat)
  assert.equal(loadObjectPreviews(first, emptyCatalog, cat), pending)
  const other = loadObjectPreviews(second, emptyCatalog, cat)
  assert.notEqual(pending, other)
  assert.deepEqual(await pending, { base: {}, soul: {} })
  assert.deepEqual(await other, { base: {}, soul: {} })
})

test('failed atlas extraction is evicted so opening again can retry', async () => {
  const archive = new GameArchive(createZip([]))
  const cat = category('Joker')
  const first = loadObjectPreviews(archive, catalog, cat)
  await assert.rejects(first, /Jokers.png not found/)
  const retry = loadObjectPreviews(archive, catalog, cat)
  assert.notEqual(first, retry)
  await assert.rejects(retry, /Jokers.png not found/)
})

test('all five legendary Jokers have distinct background and portrait cells', () => {
  const cells = objectPreviewPlan(catalog, category('Joker')).get('Jokers.png')!
  for (const [i, key] of [
    'j_caino',
    'j_triboulet',
    'j_yorick',
    'j_chicot',
    'j_perkeo',
  ].entries()) {
    assert.deepEqual(cells.find((c) => c.id === `base:${key}`)?.rect, {
      x: (i + 3) * 71,
      y: 8 * 95,
      w: 71,
      h: 95,
    })
    assert.deepEqual(cells.find((c) => c.id === `soul:${key}`)?.rect, {
      x: (i + 3) * 71,
      y: 9 * 95,
      w: 71,
      h: 95,
    })
  }
})

test('Hologram has its own floating cell and foreground shader', () => {
  const cells = objectPreviewPlan(catalog, category('Joker')).get('Jokers.png')!
  assert.deepEqual(cells.find((c) => c.id === 'soul:j_hologram')?.rect, {
    x: 142,
    y: 855,
    w: 71,
    h: 95,
  })
  assert.equal(
    catalog.spriteObjects.Joker?.find((o) => o.key === 'j_hologram')
      ?.soulShader,
    'hologram'
  )
  assert.equal(cells.filter((c) => c.id.startsWith('soul:')).length, 6)
  assert.ok(!cells.some((c) => c.id === 'soul:j_joker'))
})

test('The Soul reads its shared gem from Enhancers, not its Tarot background atlas', () => {
  const plan = objectPreviewPlan(catalog, category('Spectral'))
  assert.deepEqual(
    plan.get('Tarots.png')?.find((c) => c.id === 'base:c_soul')?.rect,
    { x: 142, y: 190, w: 71, h: 95 }
  )
  assert.deepEqual(plan.get('Enhancers.png'), [
    { id: 'soul:c_soul', rect: { x: 0, y: 95, w: 71, h: 95 } },
  ])
  assert.equal(
    catalog.spriteObjects.Spectral?.find((o) => o.key === 'c_soul')?.soulTarget,
    'shared'
  )
  assert.equal(category('Spectral').soul, true)
})

test('seal position overrides still work after the layered preview refactor', () => {
  const plan = objectPreviewPlan(catalog, category('Seal'))
  assert.deepEqual(
    plan.get('Enhancers.png')?.find((c) => c.id === 'base:Gold')?.rect,
    { x: 142, y: 0, w: 71, h: 95 }
  )
})
