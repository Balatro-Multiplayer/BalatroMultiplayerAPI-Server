import { describe, test } from 'bun:test'
import assert from 'node:assert/strict'
import { fileFromSaved, pickExeHandle, supportsFsAccess } from './exeStore'

async function withPicker(
  picker: ((options?: unknown) => Promise<FileSystemFileHandle[]>) | undefined,
  run: () => Promise<void>
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { showOpenFilePicker: picker },
  })
  try {
    await run()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

describe('game file picker and remembered imports', () => {
  test('native picker offers Windows, LÖVE, and compressed Mac apps', async () => {
    const handle = { name: 'Balatro.love' } as FileSystemFileHandle
    let received: unknown
    await withPicker(
      async (options) => {
        received = options
        return [handle]
      },
      async () => {
        assert.equal(supportsFsAccess(), true)
        assert.equal(await pickExeHandle(), handle)
        assert.deepEqual(received, {
          id: 'balatro-exe',
          types: [
            {
              description: 'Balatro',
              accept: {
                'application/vnd.microsoft.portable-executable': ['.exe'],
                'application/zip': ['.love', '.zip'],
              },
            },
          ],
        })
      }
    )
  })

  test('unsupported browser uses the file-input fallback', async () => {
    await withPicker(undefined, async () => {
      assert.equal(supportsFsAccess(), false)
      assert.equal(await pickExeHandle(), null)
    })
  })

  test('canceling the native picker is not an import failure', async () => {
    await withPicker(
      async () => {
        throw new DOMException('Canceled', 'AbortError')
      },
      async () => {
        assert.equal(await pickExeHandle(), null)
      }
    )
  })

  test('other picker errors reach the caller', async () => {
    await withPicker(
      async () => {
        throw new Error('Read failed')
      },
      async () => {
        await assert.rejects(pickExeHandle(), /Read failed/)
      }
    )
  })

  for (const name of ['Balatro.exe', 'Balatro.love']) {
    test(`remembered ${name} bytes still reopen with their original name`, async () => {
      const blob = new Blob(['synthetic bytes'])
      const result = await fileFromSaved({ kind: 'bytes', name, blob })
      assert.ok(result)
      assert.equal(result.name, name)
      assert.equal(await result.text(), 'synthetic bytes')
    })
  }

  test('remembered file handle requests read permission when necessary', async () => {
    const source = new File(['synthetic bytes'], 'Balatro.love')
    const requests: string[] = []
    const handle = {
      getFile: async () => source,
      queryPermission: async () => 'prompt',
      requestPermission: async ({ mode }: { mode: string }) => {
        requests.push(mode)
        return 'granted'
      },
    } as unknown as FileSystemFileHandle
    assert.equal(
      await fileFromSaved({ kind: 'handle', name: source.name, handle }),
      source
    )
    assert.deepEqual(requests, ['read'])
  })

  test('declining saved-handle permission does not read the file', async () => {
    const handle = {
      getFile: async () => {
        throw new Error('must not read')
      },
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'denied',
    } as unknown as FileSystemFileHandle
    assert.equal(
      await fileFromSaved({ kind: 'handle', name: 'Balatro.exe', handle }),
      null
    )
  })
})
