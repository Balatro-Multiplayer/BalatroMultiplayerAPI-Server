// Resolve the user's Windows game, LÖVE archive, or macOS app to the same
// archive bytes. All reads stay in the browser; no game code is executed.
import { inflateRaw, readFusedZip } from './exeAssets'

const MAX_IMPORT_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024

export interface GameImportProgress {
  stage: 'reading' | 'inspecting' | 'extracting' | 'validating' | 'remembering'
  loaded?: number
  total?: number
}

function isAppArchive(path: string): boolean {
  const parts = path.split('/')
  return (
    !parts.some((part) => part === '__MACOSX' || part.startsWith('.')) &&
    /(?:^|\/)[^/]+\.app\/Contents\/Resources\/[^/]+\.love$/i.test(path)
  )
}

function singleAppArchive<T>(entries: Array<{ path: string; value: T }>): T {
  const matches = entries.filter(({ path }) => isAppArchive(path))
  const match = matches[0]
  if (!match) {
    throw new Error(
      'No game archive found. Select the installation folder containing Balatro.app, or use Choose ZIP / .love / .exe for Balatro.zip or Balatro.love. To find the .love: Balatro.app → Show Package Contents → Contents → Resources.'
    )
  }
  if (matches.length > 1) {
    throw new Error(
      'More than one app archive found. Select just one Balatro.app, or choose its Balatro.love directly.'
    )
  }
  return match.value
}

/** A folder input includes relative paths, even when the app's containing
 *  folder was selected. Only return the archive; never read unrelated files. */
export function findAppLove(files: Iterable<File>): File {
  return singleAppArchive(
    Array.from(files, (file) => ({
      path: file.webkitRelativePath,
      value: file,
    }))
  )
}

/** Normalize a Finder-compressed .app to its inner .love. Return that File too,
 *  so IndexedDB remembers only the game archive, not the whole application. */
export async function readGameFile(
  source: File,
  onProgress: (progress: GameImportProgress) => void = () => {}
): Promise<{ bytes: Uint8Array; file: File }> {
  if (!/\.(exe|love|zip)$/i.test(source.name)) {
    throw new Error(
      'Choose Balatro.exe, Balatro.love, or a ZIP of Balatro.app. For an uncompressed app, use Choose installation folder and select the folder containing Balatro.app.'
    )
  }
  if (source.size > MAX_IMPORT_BYTES) {
    throw new Error(
      'This file is too large (maximum 512 MiB). Choose Balatro.love directly.'
    )
  }
  onProgress({ stage: 'reading' })
  let bytes: Uint8Array = new Uint8Array(await source.arrayBuffer())
  let file = source
  if (/\.zip$/i.test(source.name)) {
    onProgress({ stage: 'inspecting' })
    const entries = readFusedZip(bytes)
    const { path, entry } = singleAppArchive(
      Array.from(entries, ([path, entry]) => ({
        path,
        value: { path, entry },
      }))
    )
    if (entry.size > MAX_ARCHIVE_BYTES) {
      throw new Error('The game archive is too large (maximum 256 MiB).')
    }
    onProgress({ stage: 'extracting', loaded: 0, total: entry.size })
    bytes =
      entry.method === 0
        ? entry.data
        : await inflateRaw(entry.data, entry.size, (loaded) =>
            onProgress({ stage: 'extracting', loaded, total: entry.size })
          )
    if (bytes.length !== entry.size)
      throw new Error('The app archive is damaged.')
    file = new File(
      [bytes as BlobPart],
      path.slice(path.lastIndexOf('/') + 1),
      {
        type: 'application/zip',
      }
    )
  }
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error('The game archive is too large (maximum 256 MiB).')
  }
  onProgress({ stage: 'validating' })
  const entries = readFusedZip(bytes)
  for (const path of [
    'main.lua',
    'resources/textures/1x/Jokers.png',
    'localization/en-us.lua',
  ]) {
    if (!entries.has(path)) {
      throw new Error(
        'This is not a supported Balatro game archive. Choose Balatro.exe or the Balatro.love inside Balatro.app/Contents/Resources.'
      )
    }
  }
  return { bytes, file }
}
