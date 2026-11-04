'use client'

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { newDeckSkin, skinName } from '../lib/deckSkins'
import type { GameArchive } from '../lib/gameArchive'
import { loadSheetPreviews } from '../lib/sheetPreviews'
import type { CatalogSheet, PlayingCardSkin } from '../lib/types'
import { useAssetModal } from './asset-modal'
import { UploadTile } from './upload-tile'

export function DeckSkinsEditor({
  skins,
  setSkins,
  modName,
  sheet,
  archive,
}: {
  skins: PlayingCardSkin[]
  setSkins: Dispatch<SetStateAction<PlayingCardSkin[]>>
  modName: string
  sheet: CatalogSheet
  archive: GameArchive | null
}) {
  const { openAsset } = useAssetModal()
  const [originals, setOriginals] = useState<{
    archive: GameArchive
    low?: string
    high?: string
    error?: boolean
  } | null>(null)
  const contrastSheet = (contrast: 'low' | 'high') =>
    contrast === 'low'
      ? sheet
      : { ...sheet, id: `${sheet.id}_high`, atlasKey: 'cards_2' }
  useEffect(() => {
    if (!archive) return
    let live = true
    const highSheet = { ...sheet, id: `${sheet.id}_high`, atlasKey: 'cards_2' }
    Promise.allSettled([
      loadSheetPreviews(archive, sheet),
      loadSheetPreviews(archive, highSheet),
    ]).then(([low, high]) => {
      if (live)
        setOriginals({
          archive,
          low: low.status === 'fulfilled' ? low.value[0] : undefined,
          high: high.status === 'fulfilled' ? high.value[0] : undefined,
          error: low.status === 'rejected' || high.status === 'rejected',
        })
    })
    return () => {
      live = false
    }
  }, [archive, sheet])
  const current = originals?.archive === archive ? originals : null
  const update = (id: string, edit: Partial<PlayingCardSkin>) =>
    setSkins((previous) =>
      previous.map((skin) => (skin.id === id ? { ...skin, ...edit } : skin))
    )

  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        Add named skins to Customize Deck for all four suits. Each sheet is a
        13×4 grid (923×380 at 1x, 1846×760 at 2x). Supply either contrast or
        both; a missing variant uses the other sheet. Default cards stay
        unchanged.
      </p>
      {archive && !current && (
        <p role='status' className='text-muted-foreground text-xs'>
          Loading original contrast sheets…
        </p>
      )}
      {current?.error && (
        <p role='status' className='text-muted-foreground text-xs'>
          Some original art could not be loaded. You can still upload your own
          sheets.
        </p>
      )}
      {skins.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          No card skins yet. Add one to get started.
        </p>
      )}
      {skins.map((skin) => (
        <section
          key={skin.id}
          aria-label={`Card skin: ${skinName(skin, modName)}`}
          className='space-y-3 rounded-lg border p-4'
        >
          <div className='flex flex-wrap items-end gap-3'>
            <div className='min-w-0 flex-1 space-y-1'>
              <Label htmlFor={`skin-name-${skin.id}`}>Skin name</Label>
              <Input
                id={`skin-name-${skin.id}`}
                value={skin.name}
                placeholder={modName || 'CustomReskin'}
                onChange={(event) =>
                  update(skin.id, { name: event.target.value })
                }
              />
            </div>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                if (
                  (skin.low || skin.high) &&
                  !confirm(
                    `Remove card skin “${skinName(skin, modName)}” and its uploaded sheets?`
                  )
                )
                  return
                setSkins((previous) =>
                  previous.filter((entry) => entry.id !== skin.id)
                )
              }}
            >
              Remove skin
            </Button>
          </div>
          <div className='grid min-w-0 gap-4 sm:grid-cols-2'>
            {(['low', 'high'] as const).map((contrast) => {
              const other = contrast === 'low' ? 'high' : 'low'
              const label = `${contrast === 'low' ? 'Low' : 'High'} contrast`
              const preview = skin[contrast]
              const fallback = skin[other] || current?.[contrast]
              return (
                <div key={contrast} className='min-w-0 space-y-1'>
                  <UploadTile
                    label={label}
                    ratio={923 / 380}
                    preview={preview}
                    defaultPreview={fallback}
                    hasEdit={Boolean(preview)}
                    onOpen={() =>
                      openAsset({
                        kind: 'cell',
                        title: `${skinName(skin, modName)} — ${label}`,
                        targetW: 923,
                        targetH: 380,
                        value: preview,
                        defaultPreview: fallback,
                        defaultPreviewNote: skin[other]
                          ? `Uses your ${other}-contrast sheet until you upload a separate image.`
                          : undefined,
                        loadDefaultPreview: archive
                          ? () =>
                              loadSheetPreviews(
                                archive,
                                contrastSheet(contrast)
                              ).then((images) => images[0])
                          : undefined,
                        commit: (image) =>
                          update(skin.id, { [contrast]: image ?? undefined }),
                      })
                    }
                    onClear={() => update(skin.id, { [contrast]: undefined })}
                  />
                  <p className='text-muted-foreground text-xs'>
                    {preview
                      ? 'Custom sheet uploaded.'
                      : skin[other]
                        ? `Optional — uses the ${other}-contrast sheet.`
                        : 'Upload an image. At least one contrast sheet is required.'}
                  </p>
                </div>
              )
            })}
          </div>
          {!skin.low && !skin.high && (
            <p className='text-muted-foreground text-xs'>
              This skin will not appear in-game until you add a sheet.
            </p>
          )}
        </section>
      ))}
      <Button
        variant='outline'
        onClick={() => {
          const skin = newDeckSkin(modName, skins.length)
          setSkins((previous) => [...previous, skin])
        }}
      >
        Add card skin
      </Button>
    </div>
  )
}
