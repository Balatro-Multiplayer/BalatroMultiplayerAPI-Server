'use client'

import { PresetReasonsSection } from '@/components/admin/preset-reasons/preset-reasons-section'
import { presetReasonsKey } from '@/components/admin/preset-reasons/lists'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { Ladder, LadderStep } from '../players/lib/strikes'
import { AllowlistSection } from './components/allowlist-section'
import { FlagsSection } from './components/flags-section'
import { LaddersSection } from './components/ladders-section'
import { ModsSection } from './components/mods-section'
import { NoticeSection } from './components/notice-section'
import {
  type FeatureFlag,
  type ModEntry,
  SECTION_IDS,
  SECTION_TITLES,
  type SectionId,
  allowlistSummary,
  flagsSummary,
  laddersSummary,
  modsSummary,
  pickSection,
  presetsSummary,
} from './lib/drafts'

interface ConfigResponse extends Record<FeatureFlag, boolean> {
  noticeVersion: number
  noticeDate: string
  mods: ModEntry[]
  chatAllowlist: string[]
  testingMode: boolean
  // The SMODS ids of every ranked-pinned mod (Ranked Mods page).
  queueAllowedModIds: string[]
  strikeLadders: Record<Ladder, LadderStep[]>
}

export default function AdminConfigPage() {
  const { isAdmin, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()

  // An admin page: the server sends moderators nothing from it.
  const canView = isAdmin

  useEffect(() => {
    if (!pending && !canView) router.replace('/')
  }, [pending, canView, router])

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ['admin-config'],
    queryFn: () => apiFetch('/webadmin/config'),
    enabled: canView,
  })
  const { data: presets } = useQuery<{
    presetReasons: Record<string, string[]>
  }>({
    queryKey: presetReasonsKey,
    queryFn: () => apiFetch('/webadmin/preset-reasons'),
    enabled: canView,
  })

  const [section, setSection] = useState<SectionId>('flags')
  const [leaving, setLeaving] = useState<SectionId | null>(null)
  const [dirty, setDirty] = useState(false)

  // A reload or tab close with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: ['admin-config'] }),
    [qc],
  )

  if (pending || !canView) return null

  const open = (target: SectionId) => {
    const next = pickSection(section, target, dirty)
    setLeaving(next.pending)
    if (next.open !== section) {
      setDirty(false)
      setSection(next.open)
    }
  }
  const discardAndLeave = () => {
    if (!leaving) return
    setDirty(false)
    setSection(leaving)
    setLeaving(null)
  }

  const presetLists = Object.values(presets?.presetReasons ?? {})
  const summaries: Record<SectionId, string> = data
    ? {
        flags: flagsSummary(data),
        ladders: laddersSummary(
          data.strikeLadders.chat.length,
          data.strikeLadders.play.length,
        ),
        presets: presets
          ? presetsSummary(
              presetLists.length,
              presetLists.reduce((n, l) => n + l.length, 0),
            )
          : '',
        allowlist: allowlistSummary(data.chatAllowlist.length),
        mods: modsSummary(data.mods.length),
        notice: `Version ${data.noticeVersion}, from code. Read only`,
      }
    : ({} as Record<SectionId, string>)

  const body = () => {
    if (!data) return null
    switch (section) {
      case 'flags':
        return (
          <FlagsSection
            saved={data}
            queueAllowedModIds={data.queueAllowedModIds}
            testingMode={data.testingMode}
            onDirtyChange={setDirty}
            onSaved={refresh}
          />
        )
      case 'ladders':
        return (
          <LaddersSection
            saved={data.strikeLadders}
            onDirtyChange={setDirty}
            onSaved={refresh}
          />
        )
      case 'presets':
        return <PresetReasonsSection onDirtyChange={setDirty} />
      case 'allowlist':
        return (
          <AllowlistSection
            saved={data.chatAllowlist}
            onDirtyChange={setDirty}
            onSaved={refresh}
          />
        )
      case 'mods':
        return (
          <ModsSection
            saved={data.mods}
            onDirtyChange={setDirty}
            onSaved={refresh}
          />
        )
      case 'notice':
        return (
          <NoticeSection version={data.noticeVersion} date={data.noticeDate} />
        )
    }
  }

  const item = (id: SectionId) => (
    <button
      key={id}
      type='button'
      aria-current={id === section ? 'page' : undefined}
      onClick={() => open(id)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border-l-2 px-3 py-2 text-left',
        id === section
          ? 'border-destructive bg-destructive/10'
          : 'border-transparent hover:bg-accent',
      )}
    >
      <span className='min-w-0 flex-1'>
        <span className='block font-semibold text-sm'>
          {SECTION_TITLES[id]}
        </span>
        <span className='block text-muted-foreground text-xs'>
          {summaries[id]}
        </span>
      </span>
      {id === section && dirty && (
        <span className='rounded-full bg-bal-gold/20 px-2 py-0.5 text-bal-gold text-xs'>
          edited
        </span>
      )}
    </button>
  )

  return (
    <div className='w-full space-y-4 px-4 py-6'>
      <div className='text-muted-foreground text-sm'>
        Staff / Ops / <span className='text-bal-blue'>Configuration</span>
      </div>
      <div className='flex flex-wrap items-end gap-x-4 gap-y-1'>
        <h1 className='font-bold text-3xl tracking-tight'>Configuration</h1>
        <p className='text-muted-foreground text-sm'>
          Edits take effect at once, with no deploy. Every save goes in the
          staff log.
        </p>
      </div>

      {isLoading || !data ? (
        <p className='text-muted-foreground text-sm'>Loading…</p>
      ) : (
        <div className='grid grid-cols-1 gap-4 lg:h-[calc(100dvh-14rem)] lg:grid-cols-[270px_1fr]'>
          <nav
            aria-label='Configuration sections'
            className='space-y-1 self-start rounded-lg border border-border bg-card/80 p-2'
          >
            {SECTION_IDS.filter((id) => id !== 'notice').map(item)}
            <hr className='my-2 border-border' />
            {item('notice')}
          </nav>
          <div className='flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card/80'>
            {leaving && (
              <div
                role='alert'
                className='flex flex-wrap items-center gap-3 border-amber-400/50 border-b bg-amber-400/10 px-5 py-3 text-sm'
              >
                <span className='flex-1'>
                  {SECTION_TITLES[section]} has unsaved changes. Leave and
                  lose them?
                </span>
                <Button size='sm' variant='outline' onClick={() => setLeaving(null)}>
                  Stay
                </Button>
                <Button size='sm' variant='destructive' onClick={discardAndLeave}>
                  Discard and leave
                </Button>
              </div>
            )}
            {body()}
          </div>
        </div>
      )}
    </div>
  )
}
