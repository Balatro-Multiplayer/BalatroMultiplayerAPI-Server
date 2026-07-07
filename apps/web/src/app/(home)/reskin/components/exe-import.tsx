'use client'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

/** Balatro.exe import, shown above the tabs so it is available on every page of
 *  the studio. The file is read locally and never uploaded. */
export function ExeImport({
  canPickHandle,
  onPickExe,
  onExeFile,
  onForgetExe,
  savedExeName,
  borderReady,
}: {
  canPickHandle: boolean
  onPickExe: () => void
  onExeFile: (file: File | null) => void
  onForgetExe: () => void
  savedExeName: string | null
  borderReady: boolean
}) {
  return (
    <div className='space-y-2 rounded-lg border bg-card p-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Label htmlFor='reskin-exe' className='font-medium'>
          Import Balatro.exe (optional)
        </Label>
        {canPickHandle ? (
          <Button type='button' variant='outline' size='sm' onClick={onPickExe}>
            Choose Balatro.exe
          </Button>
        ) : (
          <input
            id='reskin-exe'
            type='file'
            accept='.exe'
            className='block text-sm file:mr-3 file:rounded file:border file:border-input file:bg-transparent file:px-3 file:py-1 file:text-sm hover:file:border-primary'
            onChange={(e) => onExeFile(e.target.files?.[0] ?? null)}
          />
        )}
      </div>
      <p className='text-muted-foreground text-xs'>
        {borderReady
          ? '✓ Loaded. Vanilla art shows as faded defaults, card borders and shapes are available, and the Localization tab is unlocked.'
          : 'Select your own Balatro.exe to show each object’s vanilla art as a reference, add card borders and shapes, and edit in-game text. The file is read locally in your browser and never uploaded.'}
      </p>
      {savedExeName ? (
        <p className='text-muted-foreground text-xs'>
          Remembered <span className='font-medium'>{savedExeName}</span>, you’ll
          be asked to re-import it each time you open the studio.{' '}
          <button
            type='button'
            className='underline hover:text-foreground'
            onClick={onForgetExe}
          >
            Forget it
          </button>
          .
        </p>
      ) : null}
    </div>
  )
}
