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
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { UndoStrip } from '@/components/admin/decision-bar/decision-bar'
import { staffSend } from '@/components/admin/decision-bar/delayed-send'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { nextItemId } from './lib/focus'
import { InvestigationPanel } from './components/investigation-panel'
import { QueueList } from './components/queue-list'
import {
  downloadChatLabels,
  type ListFilters,
  listQueue,
  queueKeys,
} from './lib/api'
import { ITEM_TYPES } from './lib/types'

// The queue's state lives in the URL, so a link opens the same view.
const urlState = {
  type: parseAsStringLiteral(ITEM_TYPES),
  subject: parseAsString.withDefault(''),
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
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const [url, setUrl] = useQueryStates(urlState, { history: 'replace' })
  const [subjectDraft, setSubjectDraft] = useState(url.subject)
  const [cursor, setCursor] = useState(0)
  const now = useMinuteClock()
  // The item whose action waits to be sent: it stays open on the server for
  // 5 s, so the rail marks it and the next item is never it.
  const waiting = useSyncExternalStore(
    staffSend.subscribe,
    staffSend.getSnapshot,
    () => null
  )
  const waitingId = waiting?.tag?.startsWith('queue:')
    ? Number(waiting.tag.slice('queue:'.length))
    : null

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
      status: 'open' as const,
      sort: 'priority' as const,
      subject: url.subject,
      claimedByMe: false,
      olderThanHours: 0,
      hideClaimed: true,
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
  // Opens the next item without a reload; with none left, back to the rail.
  const openNext = useCallback(
    (fromId: number) =>
      void setUrl({
        item: nextItemId(
          list?.items ?? [],
          fromId,
          waitingId === null ? [] : [waitingId]
        ),
      }),
    [setUrl, list, waitingId]
  )
  const showAllItems = useCallback(
    (playerId: string) => {
      setSubjectDraft(playerId)
      setCursor(0)
      void setUrl({
        subject: playerId,
        type: null,
        automatic: false,
        page: 1,
      })
    },
    [setUrl]
  )

  const totalOpen = list
    ? Object.values(list.counts).reduce((a, b) => a + b, 0)
    : 0

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!isModerator) return null

  const selected = url.item
  return (
    <div className='w-full px-0 md:px-4 md:py-4'>
      <div className='grid h-[calc(100dvh-4rem)] grid-cols-1 gap-4 overflow-hidden md:grid-cols-[minmax(300px,360px)_1fr]'>
        <div
          className={cn(
            'flex min-h-0 flex-col overflow-hidden border-border bg-card/80 md:rounded-lg md:border',
            selected !== null && 'hidden md:flex'
          )}
          data-testid='queue-pane'
        >
          <div className='border-border border-b px-4 py-3'>
            <h1 className='font-bold text-2xl tracking-tight'>Service Queue</h1>
            <p
              className='text-muted-foreground text-sm'
              data-testid='queue-counts'
            >
              {totalOpen} open · {list?.claimedByOthers ?? 0} claimed by others
            </p>
            {isAdmin && (
              <Button
                size='sm'
                variant='outline'
                className='mt-2'
                onClick={() => void downloadChatLabels()}
              >
                Download chat labels
              </Button>
            )}
          </div>
          <QueueList
            filters={{ ...filters, subject: subjectDraft }}
            setFilters={setFilters}
            list={list}
            isLoading={isLoading}
            selectedId={selected}
            waitingId={waitingId}
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
            'flex min-h-0 flex-col overflow-hidden border-border bg-card/80 md:rounded-lg md:border',
            selected === null && 'hidden md:flex'
          )}
          data-testid='panel-pane'
        >
          {selected === null ? (
            <p className='p-6 text-muted-foreground text-sm'>
              Pick an item from the list.
            </p>
          ) : (
            <>
              <UndoStrip />
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
                onSkip={() => openNext(selected)}
                onClosed={() => openNext(selected)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
