import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { captureGameDrop, resolveGameDrop } from './gameDrop'
import { readGameFile } from './gameImport'

function fileEntry(file: File, onRead = () => {}): FileSystemFileEntry {
  return {
    name: file.name,
    isFile: true,
    isDirectory: false,
    file(resolve: (file: File) => void) {
      onRead()
      resolve(file)
    },
  } as FileSystemFileEntry
}

function directory(
  name: string,
  batches: FileSystemEntry[][]
): FileSystemDirectoryEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      let index = 0
      return {
        readEntries(resolve: (entries: FileSystemEntry[]) => void) {
          resolve(batches[index++] ?? [])
        },
      }
    },
  } as FileSystemDirectoryEntry
}

function app(resources: FileSystemEntry[][]): FileSystemDirectoryEntry {
  return directory('Balatro.app', [
    [directory('Contents', [[directory('Resources', resources)]])],
  ])
}

for (const name of [
  'Balatro.exe',
  'Balatro.love',
  'Balatro.zip',
  'BALATRO.LOVE',
]) {
  test(`ordinary ${name} drops use the existing import path with original file identity`, async () => {
    const file = new File(['synthetic'], name)
    assert.equal(
      await resolveGameDrop({ entries: [fileEntry(file)], files: [] }),
      file
    )
    // Also works when directory-entry APIs are absent or return null.
    assert.equal(
      await resolveGameDrop({ entries: [null], files: [file] }),
      file
    )
    assert.equal(await resolveGameDrop({ entries: [], files: [file] }), file)
  })
}

test('captures entry access synchronously, ignores text items and survives protected drop data', async () => {
  const file = new File(['synthetic'], 'Balatro.love')
  let calls = 0
  const data = {
    items: [
      {
        kind: 'string',
        webkitGetAsEntry: () => {
          throw new Error('text item accessed')
        },
      },
      {
        kind: 'file',
        webkitGetAsEntry: () => {
          calls++
          return fileEntry(file)
        },
      },
    ],
    files: [file],
  }
  const captured = captureGameDrop(data as unknown as DataTransfer)
  assert.equal(calls, 1)
  data.items.length = 0
  data.files.length = 0
  assert.equal(await resolveGameDrop(captured), file)
})

test('entry API failures still allow ordinary FileList drops', async () => {
  const file = new File(['synthetic'], 'Balatro.exe')
  const captured = captureGameDrop({
    items: [
      {
        kind: 'file',
        webkitGetAsEntry: () => {
          throw new Error('unsupported')
        },
      },
    ],
    files: [file],
  } as unknown as DataTransfer)
  assert.equal(await resolveGameDrop(captured), file)
})

test('app drops find the inner archive across directory batches without reading other files', async () => {
  let archiveReads = 0
  const file = new File(['synthetic'], 'Balatro.love')
  const unreadable = fileEntry(new File(['unused'], 'Balatro.icns'), () => {
    throw new Error('unrelated file must not be read')
  })
  const bundle = app([
    [unreadable],
    [
      fileEntry(file, () => {
        archiveReads++
      }),
    ],
  ])
  assert.equal(await resolveGameDrop({ entries: [bundle], files: [] }), file)
  assert.equal(archiveReads, 1)
})

test('only traverses Contents/Resources and ignores hidden metadata, nested apps and unrelated directories', async () => {
  const neverOpen = (name: string) => {
    const entry = directory(name, [])
    entry.createReader = () => {
      throw new Error('unrelated directory opened')
    }
    return entry
  }
  const file = new File(['synthetic'], 'Balatro.love')
  const hidden = fileEntry(new File(['metadata'], '._Balatro.love'), () => {
    throw new Error('hidden file read')
  })
  const resources = directory('Resources', [
    [hidden, neverOpen('Nested.app'), fileEntry(file)],
  ])
  const bundle = directory('Balatro.app', [
    [neverOpen('Frameworks')],
    [directory('Contents', [[neverOpen('MacOS'), resources]])],
  ])
  assert.equal(await resolveGameDrop({ entries: [bundle], files: [] }), file)
})

test('multiple archives are rejected before reading either', async () => {
  const fail = () => {
    throw new Error('ambiguous archive read')
  }
  const bundle = app([
    [fileEntry(new File(['a'], 'Balatro.love'), fail)],
    [fileEntry(new File(['b'], 'Other.love'), fail)],
  ])
  await assert.rejects(
    resolveGameDrop({ entries: [bundle], files: [] }),
    /More than one .love/
  )
})

test('empty and multiple-item drops are rejected without choosing arbitrarily', async () => {
  await assert.rejects(resolveGameDrop({ entries: [], files: [] }), /one game/)
  const files = [
    new File(['a'], 'Balatro.love'),
    new File(['b'], 'Balatro.exe'),
  ]
  await assert.rejects(resolveGameDrop({ entries: [], files }), /one game/)
  await assert.rejects(
    resolveGameDrop({ entries: [null, null], files }),
    /one game/
  )
})

test('an opaque app file gets actionable folder and ZIP fallbacks', async () => {
  const opaque = new File([], 'Balatro.app')
  await assert.rejects(
    resolveGameDrop({ entries: [], files: [opaque] }),
    /Choose installation folder.*ZIP/
  )
  await assert.rejects(
    resolveGameDrop({ entries: [fileEntry(opaque)], files: [] }),
    /could not expose this app bundle/
  )
})

test('resolved drops still pass through normal archive validation and progress', async () => {
  const bytes = zipSync({
    'main.lua': new Uint8Array(),
    'resources/textures/1x/Jokers.png': new Uint8Array(),
    'localization/en-us.lua': new Uint8Array(),
  })
  const file = new File([bytes as BlobPart], 'Balatro.love')
  const source = await resolveGameDrop({
    entries: [app([[fileEntry(file)]])],
    files: [],
  })
  const stages: string[] = []
  const imported = await readGameFile(source, ({ stage }) => {
    stages.push(stage)
  })
  assert.equal(imported.file, file)
  assert.deepEqual(imported.bytes, bytes)
  assert.deepEqual(stages, ['reading', 'validating'])
  const invalid = await resolveGameDrop({
    entries: [],
    files: [new File(['not a game'], 'Balatro.love')],
  })
  await assert.rejects(readGameFile(invalid))
})

test('missing bundle folders and archives have actionable errors', async () => {
  for (const entry of [
    directory('Balatro.app', []),
    directory('Balatro.app', [[directory('Contents', [])]]),
    app([]),
  ]) {
    await assert.rejects(
      resolveGameDrop({ entries: [entry], files: [] }),
      /Choose installation folder/
    )
  }
})

test('unrelated files and installation directories are not treated as game archives', async () => {
  await assert.rejects(
    resolveGameDrop({ entries: [], files: [new File(['text'], 'notes.txt')] }),
    /Drop one Balatro.app/
  )
  await assert.rejects(
    resolveGameDrop({ entries: [directory('Balatro', [])], files: [] }),
    /Drop Balatro.app itself/
  )
})

test('directory permission/read errors provide the app fallback', async () => {
  const entry = directory('Balatro.app', [])
  entry.createReader = () =>
    ({
      readEntries(_resolve: unknown, reject: (error: DOMException) => void) {
        reject(new DOMException('Denied', 'NotAllowedError'))
      },
    }) as FileSystemDirectoryReader
  await assert.rejects(
    resolveGameDrop({ entries: [entry], files: [] }),
    /Could not read the dropped app.*Choose installation folder/
  )
})

test('directory entry count is bounded', async () => {
  const entry = directory('Balatro.app', [
    Array.from({ length: 10_001 }, () => fileEntry(new File([], 'unused'))),
  ])
  await assert.rejects(
    resolveGameDrop({ entries: [entry], files: [] }),
    /too many directory entries/
  )
})

test('a stalled directory lookup times out with a fallback instead of staying busy forever', async () => {
  const entry = directory('Balatro.app', [])
  entry.createReader = () => ({ readEntries() {} }) as FileSystemDirectoryReader
  const nativeTimeout = globalThis.setTimeout
  let requestedMs = 0
  globalThis.setTimeout = ((callback: () => void, ms: number) => {
    requestedMs = ms
    return nativeTimeout(callback, 0)
  }) as typeof setTimeout
  try {
    await assert.rejects(
      resolveGameDrop({ entries: [entry], files: [] }),
      /took too long.*Choose installation folder/
    )
    assert.ok(requestedMs > 0 && requestedMs <= 15_000)
  } finally {
    globalThis.setTimeout = nativeTimeout
  }
})

test('cancel stops a pending lookup and never proceeds to read an archive', async () => {
  const controller = new AbortController()
  let lateReply: ((entries: FileSystemEntry[]) => void) | undefined
  const entry = directory('Balatro.app', [])
  entry.createReader = () =>
    ({
      readEntries(resolve: (entries: FileSystemEntry[]) => void) {
        lateReply = resolve
      },
    }) as FileSystemDirectoryReader
  const pending = resolveGameDrop(
    { entries: [entry], files: [] },
    controller.signal
  )
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  lateReply?.([directory('Contents', [])])
  await assert.rejects(
    resolveGameDrop(
      { entries: [], files: [new File([], 'Balatro.love')] },
      controller.signal
    ),
    { name: 'AbortError' }
  )
})
