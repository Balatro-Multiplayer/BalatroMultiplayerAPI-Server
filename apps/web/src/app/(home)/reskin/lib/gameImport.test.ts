import { describe, test } from 'bun:test'
import assert from 'node:assert/strict'
import { deflateSync, zipSync } from 'fflate'
import { inflateRaw, readFusedZip, readLocFromExe } from './exeAssets'
import {
  findAppLove,
  type GameImportProgress,
  readGameFile,
} from './gameImport'

// Synthetic game data only: never check in the actual game or its assets.
const enc = new TextEncoder()
const members = {
  'main.lua': enc.encode('-- synthetic fixture; never executed'),
  'resources/textures/1x/Jokers.png': new Uint8Array([137, 80, 78, 71]),
  'localization/en-us.lua': enc.encode(
    'return { descriptions = { Joker = { j_test = { name = "Test Joker", text = {"Example"} } } }, misc = {} }'
  ),
}
const love = zipSync(members)
const appPath = 'Balatro.app/Contents/Resources/Balatro.love'

function file(bytes: Uint8Array, name = 'Balatro.love', path = ''): File {
  const f = new File([bytes as BlobPart], name)
  Object.defineProperty(f, 'webkitRelativePath', { value: path })
  return f
}

function fused(zip: Uint8Array): Uint8Array {
  const prefix = enc.encode('MZ synthetic Windows executable prefix')
  const out = new Uint8Array(prefix.length + zip.length)
  out.set(prefix)
  out.set(zip, prefix.length)
  return out
}

function appZip(extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({ [appPath]: love, ...extra })
}

describe('local game file import', () => {
  test('ZIP progress follows real work and reports bounded extraction bytes', async () => {
    const progress: GameImportProgress[] = []
    await readGameFile(file(appZip(), 'Balatro.zip'), (p) => progress.push(p))
    const stages = progress
      .map((p) => p.stage)
      .filter((stage, i, all) => i === 0 || stage !== all[i - 1])
    assert.deepEqual(stages, [
      'reading',
      'inspecting',
      'extracting',
      'validating',
    ])
    const extraction = progress.filter((p) => p.stage === 'extracting')
    assert.equal(extraction[0]?.loaded, 0)
    assert.equal(extraction.at(-1)?.loaded, love.length)
    assert.ok(
      extraction.every(
        (p) =>
          p.total === love.length &&
          (p.loaded ?? -1) >= 0 &&
          (p.loaded ?? Infinity) <= love.length
      )
    )
  })

  test('direct-file progress does not invent ZIP extraction work', async () => {
    const progress: GameImportProgress[] = []
    await readGameFile(file(love), (p) => progress.push(p))
    assert.deepEqual(progress, [{ stage: 'reading' }, { stage: 'validating' }])
  })

  test('plain .love is accepted without rewriting the saved File', async () => {
    const source = file(love)
    const result = await readGameFile(source)
    assert.equal(result.file, source)
    assert.deepEqual(result.bytes, love)
  })

  test('Windows fused .exe still works', async () => {
    const bytes = fused(love)
    assert.deepEqual(
      (await readGameFile(file(bytes, 'Balatro.exe'))).bytes,
      bytes
    )
  })

  test('Windows executable with bytes after the ZIP still imports', async () => {
    const exe = fused(love)
    const bytes = new Uint8Array(exe.length + 80)
    bytes.set(exe)
    // A trailer may itself contain signature-like bytes that are not an EOCD.
    new DataView(bytes.buffer).setUint32(exe.length + 10, 0x06054b50, true)
    assert.deepEqual(
      (await readGameFile(file(bytes, 'Balatro.exe'))).bytes,
      bytes
    )
  })

  test('case-insensitive .LOVE extension is accepted', async () => {
    assert.deepEqual(
      (await readGameFile(file(love, 'BALATRO.LOVE'))).bytes,
      love
    )
  })

  for (const level of [0, 6] as const) {
    test(`Finder-style app ZIP works with compression level ${level}`, async () => {
      const outer = zipSync({ [appPath]: love }, { level })
      const source = file(outer, 'Balatro.zip')
      const result = await readGameFile(source)
      assert.deepEqual(result.bytes, love)
      assert.equal(result.file.name, 'Balatro.love')
      assert.equal(result.file.size, love.length)
      assert.notEqual(result.file, source)
      assert.deepEqual(new Uint8Array(await result.file.arrayBuffer()), love)
    })
  }

  test('app ZIP ignores AppleDouble metadata and unrelated files', async () => {
    const outer = appZip({
      '__MACOSX/Balatro.app/Contents/Resources/._Balatro.love': love,
      'Balatro.app/Contents/MacOS/love': enc.encode('not executed'),
      'Balatro.app/Contents/Resources/Info.plist': enc.encode('unused'),
    })
    assert.deepEqual(
      (await readGameFile(file(outer, 'Balatro.app.zip'))).bytes,
      love
    )
  })

  test('app may be inside a parent directory, with a differently named .love', async () => {
    const outer = zipSync({
      'Games/Balatro.app/Contents/Resources/game.love': love,
    })
    const result = await readGameFile(file(outer, 'Game.zip'))
    assert.equal(result.file.name, 'game.love')
    assert.deepEqual(result.bytes, love)
  })

  test('bare ZIP, reskin pack, or unrelated app is not reported as a loaded game', async () => {
    await assert.rejects(
      readGameFile(file(love, 'pack.zip')),
      /No game archive/
    )
    await assert.rejects(
      readGameFile(
        file(
          zipSync({ [appPath]: zipSync({ 'other.txt': enc.encode('x') }) }),
          'Wrong.zip'
        )
      ),
      /not a supported Balatro/
    )
  })

  test('ambiguous app ZIP is rejected rather than picking an arbitrary installation', async () => {
    const outer = appZip({
      'Copy/Balatro.app/Contents/Resources/Balatro.love': love,
    })
    await assert.rejects(readGameFile(file(outer, 'Apps.zip')), /More than one/)
  })

  test('random, truncated, and incorrectly named files are rejected', async () => {
    await assert.rejects(
      readGameFile(file(enc.encode('not a zip'))),
      /Not a ZIP/
    )
    await assert.rejects(
      readGameFile(file(love.subarray(0, love.length - 8))),
      /Not a ZIP/
    )
    await assert.rejects(
      readGameFile(file(love, 'Balatro.app')),
      /Choose Balatro.exe/
    )
  })

  test('rejects an oversized source before reading any bytes', async () => {
    const source = file(love)
    Object.defineProperty(source, 'size', { value: 513 * 1024 * 1024 })
    Object.defineProperty(source, 'arrayBuffer', {
      value: () => {
        throw new Error('must not read')
      },
    })
    await assert.rejects(readGameFile(source), /too large/)
  })

  test('rejects an oversized nested archive before allocating its output', async () => {
    const bytes = appZip()
    const view = new DataView(bytes.buffer)
    const eocd = bytes.length - 22
    const cd = view.getUint32(eocd + 16, true)
    view.setUint32(cd + 24, 257 * 1024 * 1024, true)
    await assert.rejects(readGameFile(file(bytes, 'Big.zip')), /too large/)
  })

  test('imported .love can use the existing localization reader', async () => {
    const { bytes } = await readGameFile(file(appZip(), 'Balatro.zip'))
    const values = await readLocFromExe(bytes, 'en-us')
    assert.equal(values['descriptions.Joker.j_test.name'], 'Test Joker')
    assert.deepEqual(values['descriptions.Joker.j_test.text'], ['Example'])
  })
})

describe('Mac folder selection', () => {
  test('selects a .love from the app bundle itself', () => {
    const archive = file(love, 'Balatro.love', appPath)
    assert.equal(findAppLove([archive]), archive)
  })

  test('selecting the Steam installation folder also works', () => {
    const archive = file(love, 'Balatro.love', `Balatro/${appPath}`)
    const other = file(
      enc.encode('unused'),
      'love',
      'Balatro/Balatro.app/Contents/MacOS/love'
    )
    Object.defineProperty(other, 'arrayBuffer', {
      value: () => {
        throw new Error('must not read unrelated files')
      },
    })
    assert.equal(findAppLove([other, archive]), archive)
  })

  test('bundle path matching is case-insensitive', () => {
    const archive = file(
      love,
      'BALATRO.LOVE',
      'BALATRO.APP/CONTENTS/RESOURCES/BALATRO.LOVE'
    )
    assert.equal(findAppLove([archive]), archive)
  })

  test('empty or wrong folder gives actionable guidance', () => {
    assert.throws(() => findAppLove([]), /Show Package Contents/)
    assert.throws(() => findAppLove([file(love)]), /Show Package Contents/)
  })

  test('AppleDouble and hidden paths cannot masquerade as the game', () => {
    assert.throws(
      () =>
        findAppLove([
          file(love, 'Balatro.love', `__MACOSX/${appPath}`),
          file(
            love,
            '._Balatro.love',
            'Balatro.app/Contents/Resources/._Balatro.love'
          ),
          file(love, 'Balatro.love', `../${appPath}`),
        ]),
      /No game archive/
    )
  })

  test('multiple installations require selecting one explicitly', () => {
    assert.throws(
      () =>
        findAppLove([
          file(love, 'Balatro.love', `Steam/${appPath}`),
          file(love, 'Balatro.love', `Backup/${appPath}`),
        ]),
      /More than one/
    )
  })
})

describe('archive compatibility and invalid input', () => {
  test('stored and deflated entries and fused offsets are supported', async () => {
    for (const level of [0, 6] as const) {
      const zip = zipSync(members, { level })
      for (const bytes of [zip, fused(zip)]) {
        const entry = readFusedZip(bytes).get('main.lua')
        assert.ok(entry)
        const result =
          entry.method === 0
            ? entry.data
            : await inflateRaw(entry.data, entry.size)
        assert.deepEqual(result, members['main.lua'])
      }
    }
  })

  test('ZIP comments containing signature bytes do not confuse directory lookup', () => {
    const bytes = new Uint8Array(love.length + 30)
    bytes.set(love)
    const view = new DataView(bytes.buffer)
    view.setUint16(love.length - 2, 30, true)
    view.setUint32(love.length, 0x06054b50, true)
    assert.equal(readFusedZip(bytes).size, 3)
  })

  for (const [label, mutate] of [
    [
      'directory signature',
      (v: DataView, cd: number) => v.setUint32(cd, 0, true),
    ],
    [
      'directory offset',
      (v: DataView) => v.setUint32(v.byteLength - 6, 0xffffff00, true),
    ],
    [
      'member length',
      (v: DataView, cd: number) => v.setUint32(cd + 20, 0xffffff00, true),
    ],
    ['local header', (v: DataView) => v.setUint32(0, 0, true)],
    [
      'unsupported compression',
      (v: DataView, cd: number) => v.setUint16(cd + 10, 99, true),
    ],
    [
      'encrypted member',
      (v: DataView, cd: number) => v.setUint16(cd + 8, 1, true),
    ],
    ['ZIP64', (v: DataView) => v.setUint16(v.byteLength - 12, 0xffff, true)],
    ['split archive', (v: DataView) => v.setUint16(v.byteLength - 18, 1, true)],
  ] as const) {
    test(`rejects malformed ${label}`, () => {
      const bytes = love.slice()
      const view = new DataView(bytes.buffer)
      const cd = view.getUint32(bytes.length - 6, true)
      mutate(view, cd)
      assert.throws(() => readFusedZip(bytes))
    })
  }

  test('JavaScript fallback works when raw DecompressionStream is absent', async () => {
    const native = globalThis.DecompressionStream
    try {
      Object.defineProperty(globalThis, 'DecompressionStream', {
        configurable: true,
        writable: true,
        value: undefined,
      })
      const plain = enc.encode('synthetic localization data')
      const compressed = deflateSync(plain)
      assert.deepEqual(await inflateRaw(compressed, plain.length), plain)
      await assert.rejects(inflateRaw(compressed, plain.length - 1), /size/)
      await assert.rejects(inflateRaw(compressed, plain.length + 1), /size/)
      const result = await readGameFile(file(appZip(), 'Balatro.zip'))
      assert.deepEqual(result.bytes, love)
      assert.equal(
        (await readLocFromExe(result.bytes, 'en-us'))[
          'descriptions.Joker.j_test.name'
        ],
        'Test Joker'
      )
    } finally {
      globalThis.DecompressionStream = native
    }
  })

  test('decompression rejects bad declared sizes and truncated streams', async () => {
    const plain = enc.encode('example')
    const compressed = deflateSync(plain)
    await assert.rejects(inflateRaw(compressed, -1), /limit/)
    await assert.rejects(inflateRaw(compressed, 257 * 1024 * 1024), /limit/)
    await assert.rejects(inflateRaw(compressed, plain.length - 1), /size/)
    await assert.rejects(inflateRaw(compressed, plain.length + 1), /Truncated/)
    await assert.rejects(inflateRaw(compressed.subarray(0, 1), plain.length))
  })
})
