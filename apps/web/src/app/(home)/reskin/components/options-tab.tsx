'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fileToDataUrl } from '../lib/image'
import type { ProjectOptions } from '../lib/types'
import { UploadTile } from './upload-tile'

export function OptionsTab({
  options,
  setOptions,
  onExeFile,
  borderReady,
}: {
  options: ProjectOptions
  setOptions: (next: ProjectOptions) => void
  onExeFile: (file: File | null) => void
  borderReady: boolean
}) {
  return (
    <div className='max-w-md space-y-4 pt-4'>
      <div className='space-y-2'>
        <Label htmlFor='reskin-name'>Pack name</Label>
        <Input
          id='reskin-name'
          value={options.displayName}
          placeholder='My Reskin'
          onChange={(e) =>
            setOptions({ ...options, displayName: e.target.value })
          }
        />
        <p className='text-muted-foreground text-xs'>
          Sets the mod's name and badge in-game and the download filename. The
          mod id stays <code>CustomReskin</code> so packs never collide.
        </p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='reskin-author'>Authors</Label>
        <Input
          id='reskin-author'
          value={options.author}
          placeholder='e.g. you, a friend'
          onChange={(e) => setOptions({ ...options, author: e.target.value })}
        />
        <p className='text-muted-foreground text-xs'>
          Comma-separated. <strong>Virtualized</strong> is always credited
          first; anyone you add follows.
        </p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='reskin-version'>Version</Label>
        <Input
          id='reskin-version'
          value={options.version}
          placeholder='1.0.0'
          onChange={(e) => setOptions({ ...options, version: e.target.value })}
        />
      </div>
      <div className='space-y-2'>
        <Label>Mod icon</Label>
        <div className='w-24'>
          <UploadTile
            label='Icon'
            ratio={1}
            preview={options.icon}
            onFile={async (f) =>
              setOptions({ ...options, icon: await fileToDataUrl(f) })
            }
            onClear={() => setOptions({ ...options, icon: undefined })}
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          Shown next to the mod in Steamodded's list. A square image works best.
        </p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='reskin-exe'>Import Balatro.exe (optional)</Label>
        <input
          id='reskin-exe'
          type='file'
          accept='.exe'
          className='block w-full text-sm file:mr-3 file:rounded file:border file:border-input file:bg-transparent file:px-3 file:py-1 file:text-sm hover:file:border-primary'
          onChange={(e) => onExeFile(e.target.files?.[0] ?? null)}
        />
        <p className='text-muted-foreground text-xs'>
          {borderReady
            ? '✓ Loaded. Vanilla art shows as faded defaults, the Joker border is available, and the Localization tab is unlocked.'
            : 'Select your own Balatro.exe to show each object’s vanilla art as a reference, wrap uploads in the Joker border, and edit in-game text. The file is read locally in your browser and never uploaded.'}
        </p>
      </div>
    </div>
  )
}
