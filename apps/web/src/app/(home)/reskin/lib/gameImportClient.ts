import type { GameImportProgress } from './gameImport'

export type GameImportReply =
  | { type: 'progress'; progress: GameImportProgress }
  | { type: 'complete'; bytes: Uint8Array; file: File }
  | { type: 'error'; message: string }

/** ZIP parsing/inflation must not freeze the UI, including the JS fallback.
 * Terminating the worker also makes cancellation effective during synchronous work. */
export function importGame(
  source: File,
  onProgress: (progress: GameImportProgress) => void,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; file: File }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Import cancelled', 'AbortError'))
      return
    }
    const worker = new Worker(
      new URL('./gameImport.worker.ts', import.meta.url)
    )
    const cleanup = () => {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      signal.removeEventListener('abort', abort)
      clearTimeout(timeout)
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    const abort = () => fail(new DOMException('Import cancelled', 'AbortError'))
    const timeout = setTimeout(
      () =>
        fail(
          new Error(
            'Import took too long. Try Balatro.love directly instead of the app ZIP.'
          )
        ),
      120_000
    )
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<GameImportReply>) => {
      if (data.type === 'progress') onProgress(data.progress)
      else if (data.type === 'error') fail(new Error(data.message))
      else {
        cleanup()
        // Preserve a direct file's identity so Chromium can remember its handle.
        resolve({
          bytes: data.bytes,
          file: /\.zip$/i.test(source.name) ? data.file : source,
        })
      }
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fail(
        new Error(
          'The import worker could not run. Refresh and try again, or choose Balatro.love directly.'
        )
      )
    }
    worker.onmessageerror = () =>
      fail(new Error('Could not receive the imported game. Please try again.'))
    try {
      worker.postMessage(source)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
