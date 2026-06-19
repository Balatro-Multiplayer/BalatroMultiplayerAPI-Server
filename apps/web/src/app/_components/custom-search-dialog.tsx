'use client'

import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
} from '@radix-ui/react-dialog'
import { useRouter } from 'fumadocs-core/framework'
import { useDocsSearch } from 'fumadocs-core/search/client'
import type { SharedProps } from 'fumadocs-ui/components/dialog/search'
import { buttonVariants } from 'fumadocs-ui/components/ui/button'
import { useI18n } from 'fumadocs-ui/contexts/i18n'
import { FileText, Hash, Loader2, SearchIcon, Text, User } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import { cn } from '@/lib/utils'
import type { SearchResult } from '@/types/search'

type SearchLink = [name: string, href: string]

type ReactSortedResult = {
  id: string
  url: string
  type: 'page' | 'heading' | 'text' | 'player'
  content: React.ReactNode
  external?: boolean
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== 'object') return false

  const result = value as Partial<SearchResult>

  if (result.type === 'player') {
    return (
      typeof result.discord_id === 'string' &&
      typeof result.username === 'string' &&
      typeof result.ranked_mmr === 'number' &&
      typeof result.url === 'string'
    )
  }

  return (
    result.type === 'doc' &&
    typeof result.id === 'string' &&
    typeof result.url === 'string' &&
    typeof result.content === 'string' &&
    (result.docType === 'page' ||
      result.docType === 'heading' ||
      result.docType === 'text')
  )
}

interface CustomSearchDialogProps extends SharedProps {
  search: string
  onSearchChange: (v: string) => void
  isLoading?: boolean
  hideResults?: boolean
  results: ReactSortedResult[] | 'empty'
  footer?: React.ReactNode
  links?: SearchLink[]
}

function CustomSearchDialogComponent({
  open,
  onOpenChange,
  footer,
  links = [],
  search,
  onSearchChange,
  isLoading,
  ...props
}: CustomSearchDialogProps) {
  const { text } = useI18n()
  const defaultItems = useMemo(
    () =>
      links.map(([name, link]) => ({
        type: 'page' as const,
        id: name,
        content: name,
        url: link,
      })),
    [links]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogOverlay className='fixed inset-0 z-50 bg-black/30 backdrop-blur-sm data-[state=closed]:animate-fd-fade-out data-[state=open]:animate-fd-fade-in' />
      <DialogContent
        aria-describedby={undefined}
        className='fixed top-[10vh] left-1/2 z-50 w-[98vw] max-w-screen-sm -translate-x-1/2 rounded-lg border bg-fd-popover text-fd-popover-foreground shadow-lg data-[state=closed]:animate-fd-dialog-out data-[state=open]:animate-fd-dialog-in'
      >
        <DialogTitle className='hidden'>{text.search}</DialogTitle>
        <div className='flex flex-row items-center gap-2 px-3'>
          <LoadingIndicator isLoading={isLoading ?? false} />
          <input
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value)
            }}
            placeholder={text.search}
            className='w-0 flex-1 bg-transparent py-3 text-base placeholder:text-fd-muted-foreground focus-visible:outline-none'
          />
          <button
            type='button'
            aria-label='Close Search'
            onClick={() => onOpenChange(false)}
            className={cn(
              buttonVariants({
                color: 'outline',
                className: 'p-1.5 text-xs',
              })
            )}
          >
            Esc
          </button>
        </div>
        {props.results !== 'empty' || defaultItems.length > 0 ? (
          <SearchResults
            items={props.results === 'empty' ? defaultItems : props.results}
            onSelect={() => onOpenChange(false)}
          />
        ) : null}
        {footer ? (
          <div className='mt-auto flex flex-col border-t p-3'>{footer}</div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const icons = {
  text: <Text className='size-4 text-fd-muted-foreground' />,
  heading: <Hash className='size-4 text-fd-muted-foreground' />,
  page: <FileText className='size-4 text-fd-muted-foreground' />,
  player: <User className='size-4 text-fd-muted-foreground' />,
}

function SearchResults({
  items,
  onSelect,
  ...props
}: {
  items: ReactSortedResult[]
  onSelect?: (url: string) => void
} & React.HTMLAttributes<HTMLDivElement>) {
  const [active, setActive] = useState<string>()
  const { text } = useI18n()
  const router = useRouter()

  if (
    items.length > 0 &&
    (!active || items.every((item) => item.id !== active))
  ) {
    setActive(items[0]?.id)
  }

  const onOpen = ({ external, url }: { external?: boolean; url: string }) => {
    if (external) window.open(url, '_blank')?.focus()
    else router.push(url)
    onSelect?.(url)
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setActive((cur) => {
        const idx = items.findIndex((item) => item.id === cur)
        if (idx === -1) return items.at(0)?.id
        return items.at(
          (e.key === 'ArrowDown' ? idx + 1 : idx - 1) % items.length
        )?.id
      })
      e.preventDefault()
    }
    if (e.key === 'Enter') {
      const selected = items.find((item) => item.id === active)
      if (selected) onOpen(selected)
      e.preventDefault()
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div
      {...props}
      className={cn(
        'flex max-h-[460px] flex-col overflow-y-auto border-t p-2',
        props.className
      )}
    >
      {items.length === 0 ? (
        <div className='py-12 text-center text-sm'>{text.searchNoResult}</div>
      ) : null}
      {items.map((item) => (
        <CommandItem
          key={item.id}
          value={item.id}
          active={active}
          onActiveChange={setActive}
          onClick={() => {
            onOpen(item)
          }}
        >
          {item.type !== 'page' && item.type !== 'player' ? (
            <div className='ms-2 h-full min-h-10 w-px bg-fd-border' />
          ) : null}
          {icons[item.type]}
          <p className='w-0 flex-1 truncate'>{item.content}</p>
        </CommandItem>
      ))}
    </div>
  )
}

function LoadingIndicator({ isLoading }: { isLoading: boolean }) {
  return (
    <div className='relative size-4'>
      <Loader2
        className={cn(
          'absolute size-full animate-spin text-fd-primary transition-opacity',
          !isLoading && 'opacity-0'
        )}
      />
      <SearchIcon
        className={cn(
          'absolute size-full text-fd-muted-foreground transition-opacity',
          isLoading && 'opacity-0'
        )}
      />
    </div>
  )
}

function CommandItem({
  active,
  onActiveChange,
  value,
  ...props
}: {
  active?: string
  onActiveChange: (v: string) => void
  value: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      ref={useCallback(
        (element: HTMLButtonElement | null) => {
          if (active === value && element) {
            element.scrollIntoView({
              block: 'nearest',
            })
          }
        },
        [active, value]
      )}
      type='button'
      onPointerMove={() => onActiveChange(value)}
      {...props}
      className={cn(
        'flex min-h-10 select-none flex-row items-center gap-2.5 rounded-lg px-2 text-start text-sm',
        active === value && 'bg-fd-accent text-fd-accent-foreground',
        props.className
      )}
    >
      {props.children}
    </button>
  )
}

export default function CustomSearchDialog(props: SharedProps) {
  const { locale } = useI18n()
  const { search, setSearch, query } = useDocsSearch(
    {
      type: 'fetch',
      api: '/api/search',
      locale,
      delayMs: 200,
    },
    [locale]
  )

  // Transform results to include custom rendering
  const transformedResults =
    query.data && Array.isArray(query.data)
      ? (query.data as unknown[]).filter(isSearchResult).map((typedResult) => {
          if (typedResult.type === 'player') {
            return {
              id: `player-${typedResult.discord_id}`,
              url: typedResult.url,
              type: 'player' as const,
              content: (
                <>
                  <span className='font-semibold'>{typedResult.username}</span>
                  <span className='ml-2 text-muted-foreground text-xs'>
                    {Math.round(typedResult.ranked_mmr)} MMR
                  </span>
                </>
              ),
            }
          }

          // Doc result
          return {
            id: typedResult.id,
            url: typedResult.url,
            type: typedResult.docType,
            content: (
              <>
                <span
                  className={
                    typedResult.docType === 'page' ? 'font-semibold' : ''
                  }
                >
                  {typedResult.content}
                </span>
              </>
            ),
          }
        })
      : query.data === 'empty'
        ? 'empty'
        : []

  return (
    <CustomSearchDialogComponent
      {...props}
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      results={
        transformedResults === 'empty' || transformedResults.length === 0
          ? 'empty'
          : transformedResults
      }
    />
  )
}
