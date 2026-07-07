'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type EdgeOption, edgeOptionsFor } from '../lib/edges'
import { getAtlasCell } from '../lib/exeAssets'
import type { ObjectEdit, ProjectOptions } from '../lib/types'
import { useAssetModal } from './asset-modal'
import { UploadTile } from './upload-tile'

export function OptionsTab({
  options,
  setOptions,
  exeBuf,
}: {
  options: ProjectOptions
  setOptions: (next: ProjectOptions) => void
  exeBuf: Uint8Array | null
}) {
  const { openAsset } = useAssetModal()

  // The Uncommon Tag cell (tags.png, 0,0). The mod icon borrows the Tag modal:
  // its Shape and Border are lifted from this tag so the icon looks native.
  const [tagCell, setTagCell] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!exeBuf) {
      setTagCell(undefined)
      return
    }
    let cancelled = false
    getAtlasCell(exeBuf, 'resources/textures/1x/tags.png', {
      x: 0,
      y: 0,
      w: 34,
      h: 34,
    })
      .then((c) => {
        if (!cancelled) setTagCell(c)
      })
      .catch(() => {
        if (!cancelled) setTagCell(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [exeBuf])

  const openIcon = () => {
    const edges: EdgeOption[] = edgeOptionsFor('Tag', 'tag_uncommon')
      .map((opt) => ({ ...opt, source: tagCell }))
      .filter((opt) => opt.value === 'shape' || Boolean(opt.source))
    openAsset({
      kind: 'object',
      title: 'Mod icon',
      targetW: 34,
      targetH: 34,
      caps: {},
      edges,
      defaultPreview: tagCell,
      value: options.icon ? { sprites: [options.icon] } : undefined,
      commit: (edit: ObjectEdit) =>
        setOptions({ ...options, icon: edit.sprites[0] }),
    })
  }
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
            onOpen={openIcon}
            onClear={() => setOptions({ ...options, icon: undefined })}
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          Shown next to the mod in Steamodded's list. A square image works best.
        </p>
      </div>
    </div>
  )
}
