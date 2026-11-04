import { test } from 'bun:test'
import assert from 'node:assert/strict'
import {
  deckSkinSpriteCount,
  migrateDeckSkins,
  newDeckSkin,
  skinName,
  validateDeckSkins,
} from './deckSkins'
import { importPack } from './importProject'
import { emptyProject, type PlayingCardSkin } from './types'
import { createZip, zipText } from './zip'

const image = 'data:image/png;base64,c3ludGhldGlj'

test('single-sheet migration is immutable, idempotent, and preserves unrelated edits', () => {
  const old = emptyProject()
  old.options.displayName = 'Old Cards'
  old.sheets = { playing_cards: { 0: image }, chips: { 1: image } }
  const migrated = migrateDeckSkins(old)
  assert.deepEqual(migrated.deckSkins, [
    { id: 'legacy', name: 'Old Cards', low: image },
  ])
  assert.deepEqual(migrated.sheets, { chips: { 1: image } })
  assert.ok(old.sheets.playing_cards)
  assert.deepEqual(old.deckSkins, [])
  assert.deepEqual(migrateDeckSkins(migrated), migrated)
})

test('schema 2 and 3 ZIPs migrate to editable named skins without losing object edits', async () => {
  for (const schema of [2, 3]) {
    const { deckSkins: _unused, ...old } = emptyProject()
    const project = {
      ...old,
      schema,
      sheets: { playing_cards: { 0: image } },
      objects: { 'Joker/j_joker': { sprites: [image] } },
    }
    const bytes = createZip([
      { name: 'reskin.project.json', data: zipText(JSON.stringify(project)) },
    ])
    const result = await importPack(
      new File([new Uint8Array(bytes)], 'old.zip')
    )
    assert.equal(result.schema, 4)
    assert.deepEqual(result.deckSkins, [
      { id: 'legacy', name: 'My Reskin', low: image },
    ])
    assert.deepEqual(result.sheets, {})
    assert.equal(result.objects['Joker/j_joker']?.base, image)
  }
})

test('new skins have distinct safe IDs on HTTP-compatible crypto and names are independent', () => {
  const first = newDeckSkin('Cards', 0)
  const second = newDeckSkin('Cards', 1)
  assert.notEqual(first.id, second.id)
  assert.equal(first.name, 'Cards')
  assert.equal(second.name, 'Cards 2')
  assert.equal(skinName({ ...first, name: ' Custom ' }, 'Mod'), 'Custom')
  assert.equal(skinName({ ...first, name: ' ' }, 'Mod'), 'Mod')
  assert.equal(skinName({ ...first, name: '' }, ''), 'CustomReskin')
  validateDeckSkins([first, second])
})

test('unsafe/duplicate IDs and malformed imported skins are rejected', () => {
  for (const id of ['../escape', '/absolute', 'a/b', '', 'a'.repeat(81)]) {
    assert.throws(() => validateDeckSkins([{ id, name: 'Bad' }]), /valid IDs/)
  }
  assert.throws(
    () =>
      validateDeckSkins([
        { id: 'same', name: 'A' },
        { id: 'same', name: 'B' },
      ]),
    /unique/
  )
  assert.throws(
    () =>
      validateDeckSkins([{ id: 'ok', name: 42 } as unknown as PlayingCardSkin]),
    /Invalid card skin/
  )
})

test('malformed skin lists and non-string contrast images are rejected on import', async () => {
  for (const deckSkins of [
    null,
    {},
    [{ id: 'ok', name: 'Bad low', low: 42 }],
    [{ id: 'ok', name: 'Bad high', high: false }],
    [{ id: 'UPPERCASE', name: 'Bad ID' }],
  ]) {
    const bytes = createZip([
      {
        name: 'reskin.project.json',
        data: zipText(JSON.stringify({ ...emptyProject(), deckSkins })),
      },
    ])
    await assert.rejects(
      importPack(new File([new Uint8Array(bytes)], 'invalid.zip')),
      /card skins|card skin|valid IDs/
    )
  }
})

test('sprite counts count only explicitly supplied variants, not fallbacks or drafts', () => {
  assert.equal(
    deckSkinSpriteCount([
      { id: 'draft', name: '' },
      { id: 'low', name: '', low: image },
      { id: 'high', name: '', high: image },
      { id: 'both', name: '', low: image, high: image },
    ]),
    4
  )
})
