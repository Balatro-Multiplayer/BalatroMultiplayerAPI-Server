import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { type GameImportReply, importGame } from './gameImportClient'

class MockWorker {
  static latest: MockWorker
  terminated = false
  source?: File
  onmessage?: (event: { data: GameImportReply }) => void
  onerror?: (event: { preventDefault: () => void }) => void
  onmessageerror?: () => void
  constructor() {
    MockWorker.latest = this
  }
  postMessage(source: File) {
    this.source = source
  }
  terminate() {
    this.terminated = true
  }
  reply(data: GameImportReply) {
    this.onmessage?.({ data })
  }
}

async function withWorker(run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: MockWorker,
  })
  try {
    await run()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
    else Reflect.deleteProperty(globalThis, 'Worker')
  }
}

const source = new File(['synthetic'], 'Balatro.love')
const bytes = new Uint8Array([1, 2, 3])

test('worker forwards progress and preserves direct-file identity for handle persistence', async () => {
  await withWorker(async () => {
    const reports: unknown[] = []
    const controller = new AbortController()
    const pending = importGame(
      source,
      (p) => reports.push(p),
      controller.signal
    )
    const worker = MockWorker.latest
    assert.equal(worker.source, source)
    worker.reply({ type: 'progress', progress: { stage: 'reading' } })
    worker.reply({
      type: 'complete',
      bytes,
      file: new File(['clone'], source.name),
    })
    const result = await pending
    assert.equal(result.file, source)
    assert.equal(result.bytes, bytes)
    assert.deepEqual(reports, [{ stage: 'reading' }])
    assert.equal(worker.terminated, true)
    controller.abort() // settled import has removed its abort listener
  })
})

test('ZIP import returns only the normalized inner archive', async () => {
  await withWorker(async () => {
    const pending = importGame(
      new File(['zip'], 'Balatro.zip'),
      () => {},
      new AbortController().signal
    )
    const inner = new File(['love'], 'Balatro.love')
    MockWorker.latest.reply({ type: 'complete', bytes, file: inner })
    assert.equal((await pending).file, inner)
  })
})

test('cancelling active work terminates the worker and rejects with AbortError', async () => {
  await withWorker(async () => {
    const controller = new AbortController()
    const pending = importGame(source, () => {}, controller.signal)
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(MockWorker.latest.terminated, true)
  })
})

test('already-cancelled work never starts', async () => {
  await withWorker(async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      importGame(source, () => {}, controller.signal),
      { name: 'AbortError' }
    )
  })
})

test('archive errors propagate and release the worker', async () => {
  await withWorker(async () => {
    const pending = importGame(source, () => {}, new AbortController().signal)
    MockWorker.latest.reply({ type: 'error', message: 'Not a ZIP archive' })
    await assert.rejects(pending, /Not a ZIP/)
    assert.equal(MockWorker.latest.terminated, true)
  })
})

test('worker startup errors are actionable and release resources', async () => {
  await withWorker(async () => {
    const pending = importGame(source, () => {}, new AbortController().signal)
    MockWorker.latest.onerror?.({ preventDefault() {} })
    await assert.rejects(pending, /worker could not run/)
    assert.equal(MockWorker.latest.terminated, true)
  })
})

test('stalled imports time out and release the worker', async () => {
  await withWorker(async () => {
    const nativeTimeout = globalThis.setTimeout
    const nativeClear = globalThis.clearTimeout
    let fireTimeout: (() => void) | undefined
    let timeoutMs: number | undefined
    let cleared = false
    globalThis.setTimeout = ((callback: () => void, ms: number) => {
      fireTimeout = callback
      timeoutMs = ms
      return 123
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = (() => {
      cleared = true
    }) as typeof clearTimeout
    try {
      const pending = importGame(source, () => {}, new AbortController().signal)
      assert.equal(timeoutMs, 120_000)
      fireTimeout?.()
      await assert.rejects(pending, /took too long/)
      assert.equal(MockWorker.latest.terminated, true)
      assert.equal(cleared, true)
    } finally {
      globalThis.setTimeout = nativeTimeout
      globalThis.clearTimeout = nativeClear
    }
  })
})

test('worker message errors release resources', async () => {
  await withWorker(async () => {
    const pending = importGame(source, () => {}, new AbortController().signal)
    MockWorker.latest.onmessageerror?.()
    await assert.rejects(pending, /Could not receive/)
    assert.equal(MockWorker.latest.terminated, true)
  })
})
