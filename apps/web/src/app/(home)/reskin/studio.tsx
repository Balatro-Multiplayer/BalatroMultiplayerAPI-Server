'use client'

import { Download, RotateCcw, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AssetsTab } from './components/assets-tab'
import { LocalizationTab } from './components/localization-tab'
import { OptionsTab } from './components/options-tab'
import catalogJson from './data/catalog.json'
import { type BorderTemplate, extractJokerBorder } from './lib/exeAssets'
import { generatePack } from './lib/generate'
import { importPack } from './lib/importProject'
import {
  type Catalog,
  emptyProject,
  type ObjectEdit,
  objId,
  type ProjectState,
} from './lib/types'

const catalog = catalogJson as unknown as Catalog

export function ReskinStudio() {
  const [project, setProject] = useState<ProjectState>(emptyProject)
  const [busy, setBusy] = useState(false)
  const [border, setBorder] = useState<BorderTemplate | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  // Optional: read the user's own Balatro.exe locally to lift a card-border
  // template. Never uploaded; only their own generated pack uses it.
  const onExeFile = useCallback(async (file: File | null) => {
    if (!file) {
      setBorder(null)
      return
    }
    setBusy(true)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      setBorder(await extractJokerBorder(buf))
      toast.success('Joker border loaded', {
        description: 'Card uploads can now wrap art in the vanilla border.',
      })
    } catch (e) {
      setBorder(null)
      toast.error('Could not read Balatro.exe', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
    }
  }, [])

  const setObject = useCallback(
    (catId: string, key: string, edit: ObjectEdit | null) => {
      setProject((p) => {
        const objects = { ...p.objects }
        const id = objId(catId, key)
        if (edit && (edit.sprites.some(Boolean) || edit.soul || edit.shader))
          objects[id] = edit
        else delete objects[id]
        return { ...p, objects }
      })
    },
    []
  )

  const setSheetCell = useCallback(
    (sheetId: string, index: number, dataUrl: string | null) => {
      setProject((p) => {
        const sheets = { ...p.sheets }
        const cells = { ...(sheets[sheetId] ?? {}) }
        if (dataUrl) cells[index] = dataUrl
        else delete cells[index]
        if (Object.keys(cells).length === 0) delete sheets[sheetId]
        else sheets[sheetId] = cells
        return { ...p, sheets }
      })
    },
    []
  )

  const setLocValue = useCallback(
    (lang: string, path: string, value: string | string[] | null) => {
      setProject((p) => {
        const loc = { ...p.loc }
        const langEdits = { ...(loc[lang] ?? {}) }
        if (value === null || (Array.isArray(value) && value.length === 0))
          delete langEdits[path]
        else langEdits[path] = value
        if (Object.keys(langEdits).length === 0) delete loc[lang]
        else loc[lang] = langEdits
        return { ...p, loc }
      })
    },
    []
  )

  const setOptions = useCallback((next: ProjectState['options']) => {
    setProject((p) => ({ ...p, options: next }))
  }, [])

  const spriteCount =
    Object.keys(project.objects).length +
    Object.values(project.sheets).reduce((n, c) => n + Object.keys(c).length, 0)
  const langs = Object.keys(project.loc)
  const textCount = langs.reduce(
    (n, l) => n + Object.keys(project.loc[l]!).length,
    0
  )

  async function onGenerate() {
    setBusy(true)
    try {
      const { bytes, fileName, warnings } = await generatePack(project, catalog)
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/zip',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Generated ${fileName}`, {
        description: 'Unzip it into your Balatro Mods folder.',
      })
      for (const w of warnings) toast.warning(w)
    } catch (e) {
      toast.error('Failed to generate pack', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  async function onImport(file: File) {
    setBusy(true)
    try {
      setProject(await importPack(file))
      toast.success('Pack imported', {
        description: 'Your previous edits are loaded.',
      })
    } catch (e) {
      toast.error('Could not import pack', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3'>
        <div className='text-muted-foreground text-sm'>
          <span className='font-medium text-foreground'>{spriteCount}</span>{' '}
          sprite
          {spriteCount === 1 ? '' : 's'} ·{' '}
          <span className='font-medium text-foreground'>{textCount}</span> text
          edit
          {textCount === 1 ? '' : 's'} across{' '}
          <span className='font-medium text-foreground'>{langs.length}</span>{' '}
          language{langs.length === 1 ? '' : 's'}
        </div>
        <div className='flex items-center gap-2'>
          <input
            ref={importRef}
            type='file'
            accept='.zip'
            className='hidden'
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
            }}
          />
          <Button
            variant='ghost'
            size='sm'
            disabled={busy}
            onClick={() => {
              if (confirm('Clear all edits and start over?'))
                setProject(emptyProject())
            }}
          >
            <RotateCcw className='mr-1 size-4' /> Reset
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={busy}
            onClick={() => importRef.current?.click()}
          >
            <Upload className='mr-1 size-4' /> Import pack
          </Button>
          <Button size='sm' disabled={busy} onClick={onGenerate}>
            <Download className='mr-1 size-4' />
            {busy ? 'Working…' : 'Generate mod'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue='sprites'>
        <TabsList>
          <TabsTrigger value='sprites'>Sprites</TabsTrigger>
          <TabsTrigger value='localization'>Localization</TabsTrigger>
          <TabsTrigger value='options'>Options</TabsTrigger>
        </TabsList>
        <TabsContent value='sprites'>
          <AssetsTab
            catalog={catalog}
            project={project}
            setObject={setObject}
            setSheetCell={setSheetCell}
            border={border}
          />
        </TabsContent>
        <TabsContent value='localization'>
          <LocalizationTab
            catalog={catalog}
            loc={project.loc}
            setLocValue={setLocValue}
          />
        </TabsContent>
        <TabsContent value='options'>
          <OptionsTab
            options={project.options}
            setOptions={setOptions}
            onExeFile={onExeFile}
            borderReady={Boolean(border)}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
