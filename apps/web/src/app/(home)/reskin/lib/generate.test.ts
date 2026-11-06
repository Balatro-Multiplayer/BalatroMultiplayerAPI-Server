import { test } from 'bun:test'
import assert from 'node:assert/strict'
import catalogData from '../data/catalog.json'
import { generatePack } from './generate'
import { importPack } from './importProject'
import {
  type Catalog,
  emptyProject,
  type ObjectEdit,
  type ProjectState,
} from './types'
import { readZip, unzipText } from './zip'

const catalog = catalogData as Catalog
const background = 'data:image/png;base64,YmFjaw=='
const overlay = 'data:image/png;base64,b3Zlcg=='

// A draw-call ledger, not a PNG encoder. Exercise the real exporter and ZIP
// paths without a DOM or copying any vanilla art into fixtures.
async function pack(
  edit?: ObjectEdit,
  id = 'Joker/j_caino',
  sheets: ProjectState['sheets'] = {},
  displayName?: string,
  deckSkins?: ProjectState['deckSkins']
) {
  const previous = ['Image', 'document'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  )
  class TestImage {
    onload?: () => void
    value = ''
    set src(src: string) {
      this.value = src
      queueMicrotask(() => this.onload?.())
    }
  }
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: TestImage,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string) {
        assert.equal(tag, 'canvas')
        const draws: unknown[] = []
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              imageSmoothingEnabled: true,
              drawImage(img: TestImage, ...args: number[]) {
                draws.push([img.value, ...args])
              },
            }
          },
          toBlob(
            this: { width: number; height: number },
            cb: (blob: Blob) => void
          ) {
            cb(
              new Blob([
                JSON.stringify({
                  width: this.width,
                  height: this.height,
                  draws,
                }),
              ])
            )
          },
        }
      },
    },
  })
  try {
    const project = emptyProject()
    if (edit) project.objects[id] = edit
    project.sheets = sheets
    if (displayName !== undefined) project.options.displayName = displayName
    if (deckSkins) project.deckSkins = deckSkins
    const result = await generatePack(project, catalog)
    const files = readZip(result.bytes)
    return {
      files,
      manifest: unzipText(files.get('data/manifest.lua')!),
      result,
    }
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

function atlas(files: Map<string, Uint8Array>, name: string, scale = 1) {
  return JSON.parse(unzipText(files.get(`assets/${scale}x/${name}.png`)!))
}

test('playing-card sheet exports a private named deck skin with all four rows, not vanilla atlas overrides', async () => {
  const deck = 'data:image/png;base64,c3ludGhldGljLWRlY2s='
  const name = 'Bug Cards'
  const { files, manifest, result } = await pack(
    undefined,
    undefined,
    {
      playing_cards: { 0: deck },
    },
    name
  )
  const registration = manifest.match(/key = "deck_legacy_lc",([^}]+)/)?.[1]
  assert.ok(registration)
  assert.ok(!registration.includes('raw = true'))
  assert.match(registration, /path = "deck_legacy_lc.png"/)
  assert.match(registration, /px = 71/)
  assert.match(registration, /py = 95/)
  assert.ok(!manifest.includes('key = "cards_2"'))
  assert.match(
    manifest,
    /deck_skins = \{\s+\{\s+key = "deck_legacy",\s+name = "Bug Cards",\s+low = "deck_legacy_lc",\s+high = "deck_legacy_lc",/
  )
  const metadata = JSON.parse(unzipText(files.get('CustomReskin.json')!))
  assert.equal(metadata.name, name)
  for (const scale of [1, 2]) {
    assert.deepEqual(atlas(files, 'deck_legacy_lc', scale), {
      width: 923 * scale,
      height: 380 * scale,
      draws: [[deck, 0, 0, 923 * scale, 380 * scale]],
    })
    assert.ok(!files.has(`assets/${scale}x/cards_2.png`))
  }
  const imported = await importPack(
    new File([new Uint8Array(result.bytes)], 'pack.zip')
  )
  assert.deepEqual(imported.sheets, {})
  assert.deepEqual(imported.deckSkins, [{ id: 'legacy', name, low: deck }])
  assert.equal(imported.schema, 4)
})

test('multiple named skins export independent low/high palettes and preserve IDs on reimport', async () => {
  const skins = [
    { id: 'bugs', name: 'Bug Cards', low: background, high: overlay },
    { id: 'night', name: 'Night Cards', high: overlay },
    { id: 'day', name: 'Day Cards', low: background },
  ]
  const { files, manifest, result } = await pack(
    undefined,
    undefined,
    {},
    'My Mod',
    skins
  )
  assert.match(
    manifest,
    /key = "deck_bugs",\s+name = "Bug Cards",\s+low = "deck_bugs_lc",\s+high = "deck_bugs_hc"/
  )
  for (const id of ['night', 'day']) {
    assert.match(
      manifest,
      new RegExp(
        `key = "deck_${id}",\\s+name = "[^"]+",\\s+low = "deck_${id}_lc",\\s+high = "deck_${id}_lc"`
      )
    )
    assert.ok(!files.has(`assets/1x/deck_${id}_hc.png`))
  }
  for (const scale of [1, 2]) {
    assert.equal(atlas(files, 'deck_bugs_lc', scale).draws[0][0], background)
    assert.equal(atlas(files, 'deck_bugs_hc', scale).draws[0][0], overlay)
    assert.equal(atlas(files, 'deck_night_lc', scale).draws[0][0], overlay)
  }
  assert.ok(!manifest.includes('raw = true'))
  const imported = await importPack(
    new File([new Uint8Array(result.bytes)], 'pack.zip')
  )
  assert.deepEqual(imported.deckSkins, skins)
  assert.equal(imported.options.displayName, 'My Mod')
  const renamed = await pack(undefined, undefined, {}, 'Other Mod Name', [
    { ...skins[0]!, name: 'Renamed' },
  ])
  assert.match(renamed.manifest, /key = "deck_bugs",\s+name = "Renamed"/)
  assert.ok(renamed.files.has('assets/1x/deck_bugs_lc.png'))
})

test('draft skins are saved but not registered and identical contrast sheets share one atlas', async () => {
  const skins = [
    { id: 'empty', name: 'Later' },
    { id: 'same', name: 'Same', low: background, high: background },
  ]
  const { files, manifest, result } = await pack(
    undefined,
    undefined,
    {},
    'Mod',
    skins
  )
  assert.ok(!manifest.includes('deck_empty'))
  assert.equal(result.warnings.length, 1)
  assert.ok(result.warnings[0]?.includes('Later'))
  assert.ok(files.has('assets/1x/deck_same_lc.png'))
  assert.ok(!files.has('assets/1x/deck_same_hc.png'))
  const imported = await importPack(
    new File([new Uint8Array(result.bytes)], 'pack.zip')
  )
  assert.deepEqual(imported.deckSkins, skins)
})

test('other sheet edits do not override either playing-card contrast atlas', async () => {
  const { manifest } = await pack(undefined, undefined, {
    chips: { 0: background },
  })
  assert.match(manifest, /key = "chips"/)
  assert.ok(!manifest.includes('key = "cards_1"'))
  assert.ok(!manifest.includes('key = "cards_2"'))
  assert.ok(!manifest.includes('deck_skin'))
  assert.match(manifest, /raw = true/)
})

test('deck-skin name uses the metadata fallback and safely serializes custom mod names', async () => {
  for (const displayName of ['', 'My "Cards"\\\nΩ']) {
    const { files, manifest } = await pack(
      undefined,
      undefined,
      { playing_cards: { 0: background } },
      displayName
    )
    const metadata = JSON.parse(unzipText(files.get('CustomReskin.json')!))
    assert.equal(metadata.name, displayName || 'CustomReskin')
    assert.ok(
      manifest.includes(
        displayName
          ? 'name = "My \\"Cards\\"\\\\\\nΩ"'
          : 'name = "CustomReskin"'
      )
    )
  }
})

test('default card background exports independently of enhancements and named face skins', async () => {
  const skin = { id: 'faces', name: 'Face Art', low: overlay }
  for (const deckSkins of [[], [skin]]) {
    const { files, manifest, result } = await pack(
      { sprites: [background] },
      'Enhanced/c_base',
      {},
      undefined,
      deckSkins
    )
    assert.match(
      manifest,
      /registry = "P_CENTERS",\s+key = "c_base",\s+atlas = "cat_Enhanced",\s+x = 0,\s+y = 0/
    )
    assert.equal((manifest.match(/registry = "P_CENTERS"/g) ?? []).length, 1)
    assert.ok(!manifest.includes('key = "m_bonus"'))
    assert.ok(!manifest.includes('raw = true'))
    assert.ok(!manifest.includes('key = "cards_1"'))
    assert.ok(!manifest.includes('key = "cards_2"'))
    for (const scale of [1, 2]) {
      assert.deepEqual(atlas(files, 'cat_Enhanced', scale), {
        width: 71 * scale,
        height: 95 * scale,
        draws: [[background, 0, 0, 71 * scale, 95 * scale]],
      })
      if (deckSkins.length) {
        assert.equal(atlas(files, 'deck_faces_lc', scale).draws[0][0], overlay)
      }
    }
    const imported = await importPack(
      new File([new Uint8Array(result.bytes)], 'background.zip')
    )
    assert.deepEqual(imported.objects['Enhanced/c_base']?.sprites, [background])
    assert.deepEqual(imported.deckSkins, deckSkins)
  }
})

test('overlay-only edits export no vanilla or replacement background, and survive reimport', async () => {
  const { files, manifest, result } = await pack({ sprites: [], soul: overlay })
  assert.ok(manifest.includes('soul_atlas = "cat_Joker_soul"'))
  assert.ok(!/^\s+atlas = /m.test(manifest))
  assert.ok(!files.has('assets/1x/cat_Joker.png'))
  assert.deepEqual(atlas(files, 'cat_Joker_soul'), {
    width: 71,
    height: 95,
    draws: [[overlay, 0, 0, 71, 95]],
  })
  assert.deepEqual(atlas(files, 'cat_Joker_soul', 2), {
    width: 142,
    height: 190,
    draws: [[overlay, 0, 0, 142, 190]],
  })
  const imported = await importPack(
    new File([new Uint8Array(result.bytes)], 'pack.zip')
  )
  assert.deepEqual(imported.objects['Joker/j_caino'], {
    sprites: [],
    soul: overlay,
  })
})

test('base-only legendary exports only uploaded background and declares a compatible Steamodded version', async () => {
  const { files, manifest } = await pack({ sprites: [background] })
  assert.ok(manifest.includes('atlas = "cat_Joker"'))
  assert.ok(!manifest.includes('soul_atlas'))
  assert.ok(!files.has('assets/1x/cat_Joker_soul.png'))
  const metadata = JSON.parse(unzipText(files.get('CustomReskin.json')!))
  assert.ok(metadata.dependencies.includes('Steamodded (>=1.0.0~BETA-1814a)'))
})

test('both custom layers bind one object to independent atlases', async () => {
  const { files, manifest } = await pack({
    sprites: [background],
    soul: overlay,
  })
  assert.equal((manifest.match(/key = "j_caino"/g) ?? []).length, 1)
  assert.ok(manifest.includes('atlas = "cat_Joker"'))
  assert.ok(manifest.includes('soul_atlas = "cat_Joker_soul"'))
  assert.equal(atlas(files, 'cat_Joker').draws[0][0], background)
  assert.equal(atlas(files, 'cat_Joker_soul').draws[0][0], overlay)
})

test('hiding an overlay packs an explicitly transparent cell and roundtrips the hide flag', async () => {
  const { files, manifest, result } = await pack({
    sprites: [],
    hideSoul: true,
  })
  assert.ok(manifest.includes('soul_atlas = "cat_Joker_soul"'))
  assert.deepEqual(atlas(files, 'cat_Joker_soul').draws, [])
  assert.deepEqual(atlas(files, 'cat_Joker_soul', 2).draws, [])
  const imported = await importPack(
    new File([new Uint8Array(result.bytes)], 'pack.zip')
  )
  assert.equal(imported.objects['Joker/j_caino']?.hideSoul, true)
})

test('The Soul overlay targets the shared gem, not a new center floating sprite', async () => {
  const { files, manifest } = await pack(
    { sprites: [], soul: overlay },
    'Spectral/c_soul'
  )
  assert.ok(manifest.includes('soul_shared = true'))
  assert.ok(manifest.includes('soul_atlas = "cat_Spectral_soul"'))
  assert.ok(!files.has('assets/1x/cat_Spectral.png'))
})

test('empty and shader-only projects do not export original game art or require the newer layer API', async () => {
  for (const edit of [undefined, { sprites: [], shader: 'foil' }]) {
    const { files, manifest } = await pack(edit)
    assert.equal(
      [...files.keys()].filter((name) => name.startsWith('assets/')).length,
      0
    )
    assert.ok(manifest.includes('objects = {}'))
    const metadata = JSON.parse(unzipText(files.get('CustomReskin.json')!))
    assert.ok(metadata.dependencies.includes('Steamodded (>=1.0.0~BETA-1221a)'))
  }
})
