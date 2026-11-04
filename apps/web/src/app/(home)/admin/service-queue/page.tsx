'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from 'nuqs'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { InvestigationPanel } from './components/investigation-panel'
import { QueueList } from './components/queue-list'
import { type ListFilters, listQueue, queueKeys } from './lib/api'
import { ITEM_TYPES } from './lib/types'

// The queue's state lives in the URL, so a link opens the same view.
const urlState = {
  type: parseAsStringLiteral(ITEM_TYPES),
  status: parseAsStringLiteral([
    'open',
    'resolved',
    'all',
  ] as const).withDefault('open'),
  sort: parseAsStringLiteral(['priority', 'age'] as const).withDefault(
    'priority'
  ),
  subject: parseAsString.withDefault(''),
  mine: parseAsBoolean.withDefault(false),
  age: parseAsInteger.withDefault(0),
  page: parseAsInteger.withDefault(1),
  automatic: parseAsBoolean.withDefault(false),
  item: parseAsInteger,
}

const LIST_REFRESH_MS = 30_000
const SUBJECT_DEBOUNCE_MS = 300

// Re-renders once a minute so ages and claim countdowns stay current.
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export default function ServiceQueuePage() {
  // useQueryStates reads search params; Suspense keeps static prerender from
  // bailing out of CSR.
  return (
    <Suspense
      fallback={
        <div className='container py-8 text-muted-foreground'>Loading…</div>
      }
    >
      <ServiceQueue />
    </Suspense>
  )
}

function ServiceQueue() {
  const { isModerator, pending } = useAuth()
  const router = useRouter()
  const [url, setUrl] = useQueryStates(urlState, { history: 'replace' })
  const [subjectDraft, setSubjectDraft] = useState(url.subject)
  const [cursor, setCursor] = useState(0)
  const now = useMinuteClock()

  useEffect(() => {
    if (!pending && !isModerator) router.replace('/')
  }, [pending, isModerator, router])

  useEffect(() => {
    const t = setTimeout(() => {
      if (subjectDraft !== url.subject)
        void setUrl({ subject: subjectDraft, page: 1 })
    }, SUBJECT_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [subjectDraft, url.subject, setUrl])

  const filters: ListFilters = useMemo(
    () => ({
      // A player search looks through every item, automatic ones too.
      lane: url.subject.trim() ? null : ('main' as const),
      itemType: url.type,
      status: url.status,
      sort: url.sort,
      subject: url.subject,
      claimedByMe: url.mine,
      olderThanHours: url.age,
      page: url.page,
    }),
    [url]
  )

  const setFilters = useCallback(
    (patch: Partial<ListFilters>) => {
      if (patch.subject !== undefined) {
        setSubjectDraft(patch.subject)
        return
      }
      setCursor(0)
      void setUrl({
        ...('itemType' in patch ? { type: patch.itemType } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.sort ? { sort: patch.sort } : {}),
        ...(patch.claimedByMe !== undefined ? { mine: patch.claimedByMe } : {}),
        ...(patch.olderThanHours !== undefined
          ? { age: patch.olderThanHours }
          : {}),
        ...(patch.page !== undefined ? { page: patch.page } : {}),
      })
    },
    [setUrl]
  )

  const { data: list, isLoading } = useQuery({
    queryKey: queueKeys.list(filters),
    queryFn: () => listQueue(filters),
    enabled: isModerator,
    placeholderData: keepPreviousData,
    refetchInterval: LIST_REFRESH_MS,
  })

  const openItem = useCallback(
    (id: number) => void setUrl({ item: id }),
    [setUrl]
  )
  const showAllItems = useCallback(
    (playerId: string) => {
      setSubjectDraft(playerId)
      setCursor(0)
      void setUrl({
        subject: playerId,
        type: null,
        status: 'all',
        automatic: false,
        page: 1,
      })
    },
    [setUrl]
  )

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!isModerator) return null

  const selected = url.item
  return (
    <div className='container max-w-none px-0 md:px-4 md:py-4'>
      <div className='grid h-[calc(100dvh-4rem)] grid-cols-1 overflow-hidden border-border md:grid-cols-[minmax(320px,420px)_1fr] md:rounded-lg md:border'>
        <div
          className={cn(
            'flex min-h-0 flex-col border-border md:border-r',
            selected !== null && 'hidden md:flex'
          )}
          data-testid='queue-pane'
        >
          <div className='border-border border-b px-3 py-2'>
            <h1 className='font-bold text-xl tracking-tight'>Service Queue</h1>
            <p className='text-muted-foreground text-xs'>
              j / k to move, Enter to open. Opening an item claims it for 15
              minutes.
            </p>
          </div>
          <QueueList
            filters={{ ...filters, subject: subjectDraft }}
            setFilters={setFilters}
            list={list}
            isLoading={isLoading}
            selectedId={selected}
            cursor={cursor}
            setCursor={setCursor}
            now={now}
            onOpen={openItem}
            automaticTab={url.automatic}
            setAutomaticTab={(on) => void setUrl({ automatic: on })}
          />
        </div>
        <div
          className={cn(
            'min-h-0 overflow-y-auto',
            selected === null && 'hidden md:block'
          )}
          data-testid='panel-pane'
        >
          {selected === null ? (
            <p className='p-6 text-muted-foreground text-sm'>
              Pick an item from the queue.
            </p>
          ) : (
            <>
              <div className='border-border border-b p-2 md:hidden'>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => void setUrl({ item: null })}
                >
                  ← Back to the queue
                </Button>
              </div>
              <InvestigationPanel
                key={selected}
                itemId={selected}
                now={now}
                onOpenItem={openItem}
                onShowAllItems={showAllItems}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
