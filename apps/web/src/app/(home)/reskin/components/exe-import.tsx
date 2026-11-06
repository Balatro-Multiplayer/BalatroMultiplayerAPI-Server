'use client'

import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { captureGameDrop, resolveGameDrop } from '../lib/gameDrop'

/** Game import, shown above every tab. Files are only read locally. */
export function ExeImport({
  canPickHandle,
  onPickExe,
  onExeFile,
  onAppFiles,
  onForgetExe,
  savedExeName,
  borderReady,
  busy,
  importing,
  children,
}: {
  canPickHandle: boolean
  onPickExe: () => void
  onExeFile: (file: File | null) => void | Promise<void>
  onAppFiles: (files: File[]) => void
  onForgetExe: () => void
  savedExeName: string | null
  borderReady: boolean
  busy: boolean
  importing: boolean
  children?: ReactNode
}) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const appInput = useRef<HTMLInputElement | null>(null)
  const activeDrop = useRef<AbortController | null>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const [dropCancelled, setDropCancelled] = useState(false)
  const disabled = busy || resolving
  useEffect(() => () => activeDrop.current?.abort(), [])
  const clearDropFeedback = () => {
    setDropError(null)
    setDropCancelled(false)
  }

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (busy || activeDrop.current) return
    const controller = new AbortController()
    activeDrop.current = controller
    setDropError(null)
    setDropCancelled(false)
    try {
      // Capture entries and files before the first await; the native drop data
      // is only readable while this event is being dispatched.
      const drop = captureGameDrop(event.dataTransfer)
      if (!drop.entries.length && !drop.files.length) return
      setResolving(true)
      const file = await resolveGameDrop(drop, controller.signal)
      controller.signal.throwIfAborted()
      setResolving(false)
      await onExeFile(file)
    } catch (error) {
      if (!controller.signal.aborted) {
        setDropError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (activeDrop.current === controller) {
        activeDrop.current = null
        setResolving(false)
      }
    }
  }

  return (
    <section
      aria-label='Balatro game import'
      aria-busy={resolving || importing}
      className='space-y-2 rounded-lg border bg-card p-3'
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        dragDepth.current++
        if (!disabled) setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div
        data-game-drop-zone
        className={`rounded-md border-2 border-dashed p-4 text-center ${dragging ? 'border-primary bg-accent' : 'border-border'}`}
      >
        <p className='font-medium text-sm'>
          {resolving
            ? 'Finding Balatro.love inside the dropped app…'
            : importing
              ? 'Importing your game…'
              : dragging
                ? 'Drop your game here'
                : 'Drop Balatro.app, .love, .exe, or an app ZIP here'}
        </p>
        <p className='mt-1 text-muted-foreground text-xs'>
          One game at a time. Files stay on your device. You can also use the
          buttons below.
        </p>
        {resolving && (
          <div className='mt-2 flex items-center justify-center gap-3'>
            <span
              role='status'
              className='animate-pulse text-muted-foreground text-xs motion-reduce:animate-none'
            >
              Checking the app’s Contents → Resources folder…
            </span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => {
                activeDrop.current?.abort()
                setResolving(false)
                setDropCancelled(true)
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      {dropError && (
        <p role='alert' className='text-destructive text-sm'>
          {dropError}
        </p>
      )}
      {dropCancelled && (
        <p role='status' className='text-muted-foreground text-sm'>
          Drop cancelled. Your previous game import is unchanged.
        </p>
      )}
      <div className='flex flex-wrap items-center gap-3'>
        <span className='font-medium text-sm'>
          Import Balatro game (optional)
        </span>
        <Button
          id='reskin-exe'
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={() => {
            clearDropFeedback()
            if (canPickHandle) onPickExe()
            else fileInput.current?.click()
          }}
        >
          {importing ? 'Importing game…' : 'Choose ZIP / .love / .exe'}
        </Button>
        <input
          ref={fileInput}
          type='file'
          accept='.exe,.love,.zip'
          hidden
          disabled={disabled}
          aria-label='Choose Balatro.zip, Balatro.love, or Balatro.exe'
          onChange={(e) => {
            onExeFile(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={() => {
            clearDropFeedback()
            appInput.current?.click()
          }}
        >
          Choose installation folder
        </Button>
        <input
          ref={(input) => {
            appInput.current = input
            input?.setAttribute('webkitdirectory', '')
          }}
          type='file'
          multiple
          hidden
          disabled={disabled}
          aria-label='Choose the installation folder containing Balatro.app'
          onChange={(e) => {
            onAppFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {children}
      <p className='text-muted-foreground text-xs'>
        <strong>Mac:</strong> try dragging <strong>Balatro.app</strong> here.
        App drops depend on your browser. If the app cannot be read, select{' '}
        <strong>Balatro.zip</strong> or <strong>Balatro.love</strong> with{' '}
        <strong>Choose ZIP / .love / .exe</strong>. The folder chooser needs the
        folder <em>containing</em> Balatro.app, not the app or ZIP itself. macOS
        may disable both in that folder-only dialog.
      </p>
      <p className='text-muted-foreground text-xs'>
        {borderReady
          ? '✓ Loaded. Vanilla art shows as faded defaults, card borders and shapes are available, and the Localization tab is unlocked.'
          : 'Import your own game archive to show vanilla art, add card borders and shapes, and edit in-game text.'}{' '}
        Everything is read locally in your browser and never uploaded. Only the
        inner .love is remembered for Mac imports.
      </p>
      <details className='text-muted-foreground text-xs'>
        <summary className='cursor-pointer font-medium hover:text-foreground'>
          Mac: where to find Balatro.app or Balatro.love
        </summary>
        <ol className='mt-2 list-decimal space-y-2 pl-5'>
          <li>
            In Steam, open <strong>Library</strong>, right-click{' '}
            <strong>Balatro</strong>, then choose{' '}
            <strong>Manage → Browse local files</strong>. Finder opens the
            installation folder. The app may appear as just “Balatro”.
          </li>
          <li>
            Drag <strong>Balatro.app</strong> from Finder onto the drop area
            above. The studio reads only its inner <strong>.love</strong>. If
            your browser will not expose the app’s contents, use one of the
            alternatives below. You can also drop .love, .exe, and app ZIP
            files.
          </li>
          <li>
            To use a ZIP: right-click <strong>Balatro.app</strong> in Finder,
            choose <strong>Compress</strong>, then click{' '}
            <strong>Choose ZIP / .love / .exe</strong> above and select the
            resulting <strong>Balatro.zip</strong>.
          </li>
          <li>
            Alternatively, click <strong>Choose installation folder</strong> and
            select the <strong>Balatro folder containing Balatro.app</strong>.
            Do not select the app itself or its ZIP: this picker only accepts
            folders, and macOS treats .app bundles as applications. The studio
            finds <code>Balatro.app/Contents/Resources/Balatro.love</code>{' '}
            automatically. Your browser may ask you to confirm folder access; no
            files are sent to a server.
          </li>
          <li>
            To import just the archive instead: right-click{' '}
            <strong>Balatro.app → Show Package Contents</strong>, then open{' '}
            <strong>Contents → Resources</strong>. Choose{' '}
            <strong>Balatro.love</strong> with{' '}
            <strong>Choose ZIP / .love / .exe</strong>. If the picker will not
            open the bundle, copy the .love file to your Desktop first.
          </li>
        </ol>
        <p className='mt-2'>
          Default Steam location: in Finder press <strong>⌘⇧G</strong> (Go to
          Folder) and paste{' '}
          <code className='break-all'>
            ~/Library/Application Support/Steam/steamapps/common/Balatro/
          </code>
          . If Steam uses another library drive, use Browse local files instead.
          No need to launch or modify the game.
        </p>
      </details>
      {savedExeName ? (
        <p className='text-muted-foreground text-xs'>
          Remembered <span className='font-medium'>{savedExeName}</span>, you’ll
          be asked to re-import it each time you open the studio.{' '}
          <button
            type='button'
            className='underline hover:text-foreground'
            disabled={disabled}
            onClick={onForgetExe}
          >
            Forget it
          </button>
          .
        </p>
      ) : null}
    </section>
  )
}
