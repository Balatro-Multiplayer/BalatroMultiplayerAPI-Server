'use client'

import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GameImportProgress } from '../lib/gameImport'

export type ImportFeedback =
  | {
      state: 'working'
      name: string
      size: number
      progress: GameImportProgress
    }
  | { state: 'success' | 'error' | 'cancelled'; message: string }

const stages: Record<GameImportProgress['stage'], string> = {
  reading: 'Reading your file',
  inspecting: 'Finding Balatro.love inside the ZIP',
  extracting: 'Extracting Balatro.love',
  validating: 'Checking the game archive',
  remembering: 'Remembering the archive in this browser',
}

export function ImportStatus({
  feedback,
  onCancel,
}: {
  feedback: ImportFeedback
  onCancel: () => void
}) {
  const working = feedback.state === 'working'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!working) return
    setElapsed(0)
    const start = Date.now()
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000
    )
    return () => clearInterval(timer)
  }, [working])

  if (feedback.state !== 'working') {
    return (
      <div
        role={feedback.state === 'error' ? 'alert' : 'status'}
        className='flex items-start gap-2 rounded-md border p-3 text-sm'
      >
        {feedback.state === 'success' ? (
          <CheckCircle2 aria-hidden='true' className='size-4 shrink-0' />
        ) : (
          <CircleAlert aria-hidden='true' className='size-4 shrink-0' />
        )}
        <p>{feedback.message}</p>
      </div>
    )
  }
  const { progress, name, size } = feedback
  const percent =
    progress.total && progress.loaded !== undefined
      ? Math.min(100, Math.floor((progress.loaded / progress.total) * 100))
      : undefined
  return (
    <div
      className='space-y-2 rounded-md border bg-muted/40 p-3'
      aria-busy='true'
    >
      <div className='flex items-center gap-2'>
        <LoaderCircle
          aria-hidden='true'
          className='size-4 shrink-0 animate-spin motion-reduce:animate-none'
        />
        <p role='status' className='flex-1 font-medium text-sm'>
          {stages[progress.stage]}…
        </p>
        <span className='text-muted-foreground text-xs'>
          {elapsed}s elapsed
        </span>
        {progress.stage !== 'remembering' && (
          <Button type='button' variant='outline' size='sm' onClick={onCancel}>
            Cancel import
          </Button>
        )}
      </div>
      <p className='break-all text-muted-foreground text-xs'>
        {name} · {(size / 1024 / 1024).toFixed(1)} MiB · Processing locally, not
        uploading
      </p>
      {percent !== undefined && (
        <div className='flex items-center gap-2'>
          <progress
            aria-label='Extracting Balatro.love'
            className='h-2 flex-1 accent-primary'
            max={100}
            value={percent}
          />
          <span className='text-xs tabular-nums'>{percent}% extracted</span>
        </div>
      )}
      <p className='text-muted-foreground text-xs'>
        {progress.stage === 'remembering'
          ? 'Archive checked. Finishing local storage so it can be re-imported next time.'
          : elapsed >= 10
            ? 'Still processing. Large app ZIPs can take a while; you can cancel and choose Balatro.love directly instead.'
            : 'Large app ZIPs may take a little while. You can cancel without losing your previous import.'}
      </p>
    </div>
  )
}
