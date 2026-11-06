import { readGameFile } from './gameImport'
import type { GameImportReply } from './gameImportClient'

// Keep DOM and WebWorker lib declarations separate in this Next.js project.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<File>) => void
  postMessage: (message: GameImportReply, transfer?: Transferable[]) => void
}

scope.onmessage = async ({ data: source }) => {
  try {
    const { bytes, file } = await readGameFile(source, (progress) => {
      scope.postMessage({ type: 'progress', progress })
    })
    scope.postMessage({ type: 'complete', bytes, file }, [
      bytes.buffer as ArrayBuffer,
    ])
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
