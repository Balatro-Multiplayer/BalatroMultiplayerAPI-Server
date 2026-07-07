'use client'

import { Download, RotateCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AssetModalProvider } from './components/asset-modal'
import { AssetsTab } from './components/assets-tab'
import { ExeImport } from './components/exe-import'
import { LocalizationTab } from './components/localization-tab'
import { OptionsTab } from './components/options-tab'
import catalogJson from './data/catalog.json'
import { readLocFromExe } from './lib/exeAssets'
import {
  fileFromSaved,
  forgetExe,
  pickExeHandle,
  recallExe,
  rememberBytes,
  rememberHandle,
  type SavedExe,
  supportsFsAccess,
} from './lib/exeStore'
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
  const [exeBuf, setExeBuf] = useState<Uint8Array | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  // Optional: read the user's own Balatro.exe locally to lift a card-border
  // template, vanilla art defaults, and in-game text. Never uploaded; only
  // their own generated pack uses it. We remember it (a file handle on
  // Chromium, else the raw bytes) so a reload can re-import it in one click.
  const [canPickHandle, setCanPickHandle] = useState(false)
  const [savedExe, setSavedExe] = useState<SavedExe | null>(null)
  const [reimportOpen, setReimportOpen] = useState(false)

  // Read the given exe locally and light up the exe-backed features. Returns
  // whether it succeeded so callers only persist a reference on success.
  const applyExe = useCallback(async (file: File): Promise<boolean> => {
    setBusy(true)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      setExeBuf(buf)
      toast.success('Balatro.exe loaded', {
        description:
          'Vanilla art now shows as defaults, borders and shapes are available, and text can be edited.',
      })
      return true
    } catch (e) {
      setExeBuf(null)
      toast.error('Could not read Balatro.exe', {
        description: e instanceof Error ? e.message : String(e),
      })
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  // Chromium path: pick a file handle we can persist and re-open later.
  const onPickExe = useCallback(async () => {
    try {
      const handle = await pickExeHandle()
      if (!handle) return
      const file = await handle.getFile()
      if (await applyExe(file)) {
        await rememberHandle(handle)
        setSavedExe({ kind: 'handle', name: handle.name, handle })
      }
    } catch (e) {
      toast.error('Could not read Balatro.exe', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [applyExe])

  // Fallback path (non-Chromium <input>): persist the raw bytes instead.
  const onExeFile = useCallback(
    async (file: File | null) => {
      if (!file) {
        setExeBuf(null)
        setSavedExe(null)
        await forgetExe()
        return
      }
      if (await applyExe(file)) {
        await rememberBytes(file)
        setSavedExe({ kind: 'bytes', name: file.name, blob: file })
      }
    },
    [applyExe]
  )

  const onForgetExe = useCallback(async () => {
    setExeBuf(null)
    setSavedExe(null)
    await forgetExe()
  }, [])

  // On load, if we have a remembered exe, ask to re-import it. "No" forgets it.
  useEffect(() => {
    setCanPickHandle(supportsFsAccess())
    let cancelled = false
    recallExe().then((saved) => {
      if (cancelled || !saved) return
      setSavedExe(saved)
      setReimportOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onReimportYes = useCallback(async () => {
    setReimportOpen(false)
    if (!savedExe) return
    try {
      const file = await fileFromSaved(savedExe)
      if (!file) {
        toast.error('Balatro.exe permission was declined', {
          description: 'It is still remembered — reload to try again.',
        })
        return
      }
      await applyExe(file)
    } catch (e) {
      toast.error('Could not re-import Balatro.exe', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [savedExe, applyExe])

  const onReimportNo = useCallback(async () => {
    setReimportOpen(false)
    setSavedExe(null)
    await forgetExe()
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

  const loadLoc = useMemo(
    () => (exeBuf ? (lang: string) => readLocFromExe(exeBuf, lang) : null),
    [exeBuf]
  )

  const spriteCount =
    Object.keys(project.objects).length +
    Object.values(project.sheets).reduce((n, c) => n + Object.keys(c).length, 0)
  const langs = Object.keys(project.loc)
  const textCount = langs.reduce(
    (n, l) => n + Object.keys(project.loc[l]!).length,
    0
  )

  // Unsaved-changes guard: any edit marks the project dirty; generating a mod
  // clears it (and a later edit re-marks it), warning before leaving the page.
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    const sprites =
      Object.keys(project.objects).length +
      Object.values(project.sheets).reduce(
        (n, c) => n + Object.keys(c).length,
        0
      )
    const texts = Object.keys(project.loc).reduce(
      (n, l) => n + Object.keys(project.loc[l] ?? {}).length,
      0
    )
    setDirty(sprites > 0 || texts > 0 || Boolean(project.options.icon))
  }, [project])
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

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
      setDirty(false)
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
    <AssetModalProvider>
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

      <ExeImport
        canPickHandle={canPickHandle}
        onPickExe={onPickExe}
        onExeFile={onExeFile}
        onForgetExe={onForgetExe}
        savedExeName={savedExe?.name ?? null}
        borderReady={Boolean(exeBuf)}
      />

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
            exeBuf={exeBuf}
          />
        </TabsContent>
        <TabsContent value='localization'>
          <LocalizationTab
            catalog={catalog}
            loc={project.loc}
            setLocValue={setLocValue}
            loadLoc={loadLoc}
          />
        </TabsContent>
        <TabsContent value='options'>
          <OptionsTab
            options={project.options}
            setOptions={setOptions}
            exeBuf={exeBuf}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog open={reimportOpen} onOpenChange={setReimportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Balatro.exe again?</AlertDialogTitle>
            <AlertDialogDescription>
              You imported{' '}
              <span className='font-medium text-foreground'>
                {savedExe?.name ?? 'Balatro.exe'}
              </span>{' '}
              last time. Re-import it to show vanilla art, the Joker border, and
              in-game text. Choosing <strong>No</strong> forgets it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onReimportNo}>No</AlertDialogCancel>
            <AlertDialogAction onClick={onReimportYes}>Yes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </AssetModalProvider>
  )
}
