// Remembering the user's Balatro.exe between visits.
//
// A file <input> only hands us a File for the current page load — there is no
// path we could persist, and cookies/localStorage are far too small for the exe
// anyway. So we keep a reference in IndexedDB (which holds both large Blobs and
// structured-cloneable handles) and re-import it on the next load behind a
// confirm prompt.
//
// Preferred (Chromium): a FileSystemFileHandle — a live pointer to the file, so
// no copy is stored and the re-read is consented through the browser itself.
// Fallback (every other browser): the raw bytes as a Blob.

export type SavedExe =
  | { kind: 'handle'; name: string; handle: FileSystemFileHandle }
  | { kind: 'bytes'; name: string; blob: Blob }

const DB_NAME = 'reskin-studio'
const DB_VERSION = 1
const STORE = 'exe'
const KEY = 'balatro'

type PermState = 'granted' | 'denied' | 'prompt'

interface PermHandle {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermState>
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermState>
}

interface FsWindow {
  showOpenFilePicker?(opts?: {
    id?: string
    multiple?: boolean
    types?: { description?: string; accept: Record<string, string[]> }[]
  }): Promise<FileSystemFileHandle[]>
}

/** Whether this browser can hand back a persistable file handle (Chromium). */
export function supportsFsAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as FsWindow).showOpenFilePicker === 'function'
  )
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(value: SavedExe): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbGet(): Promise<SavedExe | null> {
  const db = await openDb()
  try {
    return await new Promise<SavedExe | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as SavedExe) ?? null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbDel(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** The remembered exe, or null if none is saved (or IndexedDB is unavailable). */
export async function recallExe(): Promise<SavedExe | null> {
  try {
    return await idbGet()
  } catch {
    return null
  }
}

/** Drop the remembered exe (the prompt's "No"). Best-effort. */
export async function forgetExe(): Promise<void> {
  try {
    await idbDel()
  } catch {
    // best-effort — nothing else depends on the delete succeeding
  }
}

/** Remember a handle (Option A) — Chromium only. */
export async function rememberHandle(handle: FileSystemFileHandle): Promise<void> {
  await idbPut({ kind: 'handle', name: handle.name, handle })
}

/** Remember the raw bytes (Option B) — every other browser. */
export async function rememberBytes(file: File): Promise<void> {
  await idbPut({ kind: 'bytes', name: file.name, blob: file })
}

/**
 * Open a file picker that returns a persistable handle. Chromium only; returns
 * null if unsupported or the user cancels.
 */
export async function pickExeHandle(): Promise<FileSystemFileHandle | null> {
  const w = window as unknown as FsWindow
  if (!w.showOpenFilePicker) return null
  try {
    const [handle] = await w.showOpenFilePicker({
      id: 'balatro-exe',
      types: [
        {
          description: 'Balatro',
          accept: { 'application/vnd.microsoft.portable-executable': ['.exe'] },
        },
      ],
    })
    return handle ?? null
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/**
 * Re-open the saved exe as a File. For a handle this may surface the browser's
 * own read-permission prompt; returns null if the user declines it. Must be
 * called from a user gesture (the prompt's "Yes" click).
 */
export async function fileFromSaved(saved: SavedExe): Promise<File | null> {
  if (saved.kind === 'bytes') {
    return new File([saved.blob], saved.name)
  }
  const handle = saved.handle as FileSystemFileHandle & PermHandle
  if (handle.queryPermission && handle.requestPermission) {
    let state = await handle.queryPermission({ mode: 'read' })
    if (state !== 'granted') {
      state = await handle.requestPermission({ mode: 'read' })
    }
    if (state !== 'granted') return null
  }
  return handle.getFile()
}
