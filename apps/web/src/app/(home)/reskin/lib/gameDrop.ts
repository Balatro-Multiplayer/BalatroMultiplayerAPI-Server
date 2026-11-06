// A Finder app is a directory, not an ordinary file. Read only its two known
// subdirectories and the selected .love; never walk/read the rest of the bundle.
const APP_FALLBACK =
  'Your browser could not expose this app bundle. Use Choose installation folder and select the folder containing Balatro.app, compress the app in Finder and drop its ZIP, or drop the .love inside Contents → Resources.'
const MAX_DIRECTORY_ENTRIES = 10_000
const RESOLVE_TIMEOUT_MS = 15_000

export interface GameDrop {
  entries: Array<FileSystemEntry | null>
  files: File[]
}

/** Must run inside the drop event: browsers protect DataTransfer after it ends. */
export function captureGameDrop(
  data: Pick<DataTransfer, 'items' | 'files'>
): GameDrop {
  return {
    entries: Array.from(data.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => {
        try {
          return item.webkitGetAsEntry?.() ?? null
        } catch {
          return null // Ordinary files can still use the captured FileList.
        }
      }),
    files: Array.from(data.files ?? []),
  }
}

function readBeforeDeadline<T>(
  deadline: number,
  signal: AbortSignal,
  start: (resolve: (value: T) => void, reject: (error: unknown) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      reject(
        new Error(`Finding the game archive took too long. ${APP_FALLBACK}`)
      )
      return
    }
    const finish = (action: () => void) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      action()
    }
    const onAbort = () => finish(() => reject(signal.reason))
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(`Finding the game archive took too long. ${APP_FALLBACK}`)
        )
      )
    }, remaining)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      start(
        (value) => finish(() => resolve(value)),
        () =>
          finish(() =>
            reject(new Error(`Could not read the dropped app. ${APP_FALLBACK}`))
          )
      )
    } catch {
      finish(() =>
        reject(new Error(`Could not read the dropped app. ${APP_FALLBACK}`))
      )
    }
  })
}

async function listDirectory(
  directory: FileSystemDirectoryEntry,
  deadline: number,
  signal: AbortSignal
): Promise<FileSystemEntry[]> {
  signal.throwIfAborted()
  let reader: FileSystemDirectoryReader
  try {
    reader = directory.createReader()
  } catch {
    throw new Error(`Could not read the dropped app. ${APP_FALLBACK}`)
  }
  const entries: FileSystemEntry[] = []
  // Chromium returns directory entries in batches; one call is not enough.
  for (;;) {
    const batch = await readBeforeDeadline<FileSystemEntry[]>(
      deadline,
      signal,
      (resolve, reject) => reader.readEntries(resolve, reject)
    )
    if (batch.length === 0) return entries
    if (entries.length + batch.length > MAX_DIRECTORY_ENTRIES) {
      throw new Error(
        `The app contains too many directory entries. ${APP_FALLBACK}`
      )
    }
    entries.push(...batch)
  }
}

async function childDirectory(
  parent: FileSystemDirectoryEntry,
  name: string,
  deadline: number,
  signal: AbortSignal
): Promise<FileSystemDirectoryEntry> {
  const matches = (await listDirectory(parent, deadline, signal)).filter(
    (entry) =>
      entry.isDirectory && entry.name.toLowerCase() === name.toLowerCase()
  )
  if (matches.length !== 1) {
    throw new Error(`Could not find the app's ${name} folder. ${APP_FALLBACK}`)
  }
  return matches[0] as FileSystemDirectoryEntry
}

function directFile(file: File): File {
  if (/\.app$/i.test(file.name)) throw new Error(APP_FALLBACK)
  if (!/\.(love|exe|zip)$/i.test(file.name)) {
    throw new Error(
      'Drop one Balatro.app, Balatro.love, Balatro.exe, or app ZIP.'
    )
  }
  return file
}

export async function resolveGameDrop(
  drop: GameDrop,
  signal: AbortSignal = new AbortController().signal
): Promise<File> {
  signal.throwIfAborted()
  if (Math.max(drop.entries.length, drop.files.length) !== 1) {
    throw new Error('Drop one game file or Balatro.app at a time.')
  }
  const entry = drop.entries[0]
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS
  if (!entry) {
    const file = drop.files[0]
    if (!file) throw new Error(APP_FALLBACK)
    return directFile(file)
  }
  if (entry.isFile) {
    return directFile(
      await readBeforeDeadline<File>(deadline, signal, (resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject)
      )
    )
  }
  if (!entry.isDirectory || !/\.app$/i.test(entry.name)) {
    throw new Error(
      'Drop Balatro.app itself, or use Choose installation folder for its containing folder.'
    )
  }
  const contents = await childDirectory(
    entry as FileSystemDirectoryEntry,
    'Contents',
    deadline,
    signal
  )
  const resources = await childDirectory(
    contents,
    'Resources',
    deadline,
    signal
  )
  const matches = (await listDirectory(resources, deadline, signal)).filter(
    (child) =>
      child.isFile && !child.name.startsWith('.') && /\.love$/i.test(child.name)
  )
  if (matches.length === 0) {
    throw new Error(
      `No .love archive found inside the dropped app. ${APP_FALLBACK}`
    )
  }
  if (matches.length !== 1) {
    throw new Error(
      'More than one .love archive found inside the app. Drop Balatro.love directly instead.'
    )
  }
  return readBeforeDeadline<File>(deadline, signal, (resolve, reject) =>
    (matches[0] as FileSystemFileEntry).file(resolve, reject)
  )
}
