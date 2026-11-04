import { test } from 'bun:test'
import assert from 'node:assert/strict'
import catalogData from '../data/catalog.json'
import { generatePack } from './generate'
import { importPack } from './importProject'
import { type Catalog, emptyProject, type ObjectEdit } from './types'
import { readZip, unzipText } from './zip'

const catalog = catalogData as Catalog
const background = 'data:image/png;base64,YmFjaw=='
const overlay = 'data:image/png;base64,b3Zlcg=='

// A draw-call ledger, not a PNG encoder. Exercise the real exporter and ZIP
// paths without a DOM or copying any vanilla art into fixtures.
async function pack(edit?: ObjectEdit, id = 'Joker/j_caino') {
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
