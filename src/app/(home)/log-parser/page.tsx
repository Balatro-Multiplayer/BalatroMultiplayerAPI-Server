'use client'

import { Download } from 'lucide-react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useFormatter } from 'next-intl'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dropzone,
  DropzoneDescription,
  DropzoneGroup,
  DropzoneInput,
  DropzoneTitle,
  DropzoneUploadIcon,
  DropzoneZone,
} from '@/components/ui/dropzone'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { LogEvent, ParsedLogGame } from '@/lib/log-source-parser'
import { hasPermission } from '@/lib/permissions'
import { jokers } from '@/shared/jokers'
import { vouchers } from '@/shared/vouchers'
import { DeckViewsCard } from './_components/deck-view'
import { PvpBlindsCard } from './_components/pvp-blinds'
import { normalizeDeckCards } from './deck-utils'

const STAKE = {
  1: 'White Stake',
  2: 'Red Stake',
  3: 'Green Stake',
  4: 'Black Stake',
  5: 'Blue Stake',
  6: 'Purple Stake',
  7: 'Orange Stake',
  8: 'Gold Stake',
}
const STAKE_IMG = {
  1: '/stakes/white_stake.png',
  2: '/stakes/red_stake.png',
  3: '/stakes/green_stake.png',
  4: '/stakes/black_stake.png',
  5: '/stakes/blue_stake.png',
  6: '/stakes/purple_stake.png',
  7: '/stakes/orange_stake.png',
  8: '/stakes/gold_stake.png',
}

type NamedInfo = {
  description: string
  name: string
}

const DECK_INFO: Record<string, NamedInfo> = {
  abandoned: {
    name: 'Abandoned Deck',
    description: 'Start run with no face cards in your deck.',
  },
  anaglyph: {
    name: 'Anaglyph Deck',
    description: 'After each Boss Blind, gain a Double Tag.',
  },
  black: {
    name: 'Black Deck',
    description: '+1 Joker slot and -1 hand every round.',
  },
  blue: {
    name: 'Blue Deck',
    description: '+1 hand every round.',
  },
  checkered: {
    name: 'Checkered Deck',
    description: 'Start run with 26 Spades and 26 Hearts in deck.',
  },
  cocktail: {
    name: 'Cocktail Deck',
    description: 'Copies all effects of 3 other decks at random.',
  },
  echo: {
    name: 'Echo Deck',
    description:
      'Retrigger all playing cards. Blind size starts at X1.2 and increases by X0.2 each Ante.',
  },
  echodeck: {
    name: 'Echo Deck',
    description:
      'Retrigger all playing cards. Blind size starts at X1.2 and increases by X0.2 each Ante.',
  },
  erratic: {
    name: 'Erratic Deck',
    description: 'All ranks and suits in deck are randomized.',
  },
  ghost: {
    name: 'Ghost Deck',
    description:
      'Spectral cards may appear in the shop. Start with a Hex card.',
  },
  gradient: {
    name: 'Gradient Deck',
    description:
      'Cards are also considered one rank higher or lower for all Joker effects.',
  },
  green: {
    name: 'Green Deck',
    description:
      'At end of each round, earn $2 per remaining hand and $1 per remaining discard. Earn no interest.',
  },
  heidelberg: {
    name: 'Heidelberg Deck',
    description:
      'At the end of the shop, creates a Negative copy of 1 random consumable you own.',
  },
  indigo: {
    name: 'Indigo Deck',
    description:
      'Choose 1 extra card from all Booster Packs. Booster Packs are unskippable.',
  },
  magic: {
    name: 'Magic Deck',
    description: 'Start run with Crystal Ball and 2 copies of The Fool.',
  },
  nebula: {
    name: 'Nebula Deck',
    description: 'Start run with Telescope and -1 consumable slot.',
  },
  orange: {
    name: 'Orange Deck',
    description:
      'Start run with a Giga Standard Pack and 2 copies of The Hanged Man.',
  },
  oracle: {
    name: 'Oracle Deck',
    description:
      'Start run with Medium and Clearance Sale. Balance is capped at $50 plus current interest cap.',
  },
  painted: {
    name: 'Painted Deck',
    description: '+2 hand size and -1 Joker slot.',
  },
  plasma: {
    name: 'Plasma Deck',
    description:
      'Balances Chips and Mult when scoring played hands. Base Blind size is increased.',
  },
  red: {
    name: 'Red Deck',
    description: '+1 discard every round.',
  },
  violet: {
    name: 'Violet Deck',
    description:
      '+1 Voucher in shop. Vouchers are 50% off in Ante 1 and 30% off in Ante 2.',
  },
  white: {
    name: 'White Deck',
    description:
      "Lets you view the Nemesis' current deck and Joker setup. Updates at each PvP blind.",
  },
  yellow: {
    name: 'Yellow Deck',
    description: 'Start run with an extra $10.',
  },
  zodiac: {
    name: 'Zodiac Deck',
    description:
      'Start run with Tarot Merchant, Planet Merchant, and Overstock.',
  },
}

const RULESET_INFO: Record<string, NamedInfo> = {
  badlatro: {
    name: 'Badlatro',
    description:
      'Special permanent weekly-style ruleset with broad bans across jokers, consumables, tags, and more.',
  },
  blitz: {
    name: 'Standard',
    description:
      'Balanced Multiplayer ruleset with Multiplayer jokers and balance changes plus full lobby control.',
  },
  legacyranked: {
    name: 'Legacy Ranked',
    description:
      'Minimal competitive ruleset using mostly vanilla content, forced Attrition, and locked settings.',
  },
  legacy_ranked: {
    name: 'Legacy Ranked',
    description:
      'Minimal competitive ruleset using mostly vanilla content, forced Attrition, and locked settings.',
  },
  majorleague: {
    name: 'Major League',
    description:
      'Official Major League ruleset with vanilla cards, 180 second timer, The Order banned, and Attrition.',
  },
  minorleague: {
    name: 'Minor League',
    description:
      'Official Minor League ruleset with vanilla cards, 210 second timer, The Order required, and Attrition.',
  },
  sandbox: {
    name: 'Sandbox: Extra Credit',
    description:
      'Expanded competitive ruleset with Extra Credit jokers, Spectral changes, comeback reworks, and no score preview.',
  },
  smallworld: {
    name: 'Small World',
    description:
      '75% of jokers, consumables, vouchers, and tags are randomly banned each game. Replacements can duplicate.',
  },
  speedlatro: {
    name: 'Speedlatro',
    description:
      'Fast variant with an extremely short timer between PvP blinds and forced Attrition pacing.',
  },
  standardranked: {
    name: 'Standard Ranked',
    description:
      'Official competitive ruleset: Standard ruleset, forced Attrition, The Order enabled, and locked settings.',
  },
  standard_ranked: {
    name: 'Standard Ranked',
    description:
      'Official competitive ruleset: Standard ruleset, forced Attrition, The Order enabled, and locked settings.',
  },
  traditional: {
    name: 'Traditional',
    description:
      'Multiplayer content without time pressure. Timer disabled and time-based jokers banned.',
  },
  vanilla: {
    name: 'Vanilla',
    description:
      'Original Balatro ruleset with no Multiplayer jokers or balance changes.',
  },
  weekly: {
    name: 'Weekly',
    description: 'Special rotating ruleset that changes weekly or bi-weekly.',
  },
}

function normalizeLookupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^ruleset_mp_/, '')
    .replace(/^gamemode_mp_/, '')
    .replace(/^b_mp_/, '')
    .replace(/^b_/, '')
    .replace(/ deck$/i, '')
    .replace(/[^a-z0-9]+/g, '')
}

function getDeckInfo(
  value: string | null | undefined,
  cocktailDecks?: string[] | null
) {
  const raw = value?.trim()
  if (!raw) {
    return {
      name: 'Unknown',
      description: 'No deck information was present in this log.',
    }
  }

  const baseInfo = DECK_INFO[normalizeLookupKey(raw)] ?? {
    name: raw,
    description: 'No description available for this deck.',
  }

  if (
    normalizeLookupKey(raw) === 'cocktail' &&
    cocktailDecks &&
    cocktailDecks.length > 0
  ) {
    const resolvedDecks = cocktailDecks.map(formatDeckShortName).join(', ')
    return {
      name: `${baseInfo.name} (${resolvedDecks})`,
      description: `${baseInfo.description}\n\nResolved decks: ${cocktailDecks.join(', ')}`,
    }
  }

  return baseInfo
}

function getRulesetInfo(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) {
    return {
      name: 'Default',
      description: 'No explicit ruleset was present in this log.',
    }
  }

  return (
    RULESET_INFO[normalizeLookupKey(raw)] ?? {
      name: raw,
      description: 'No description available for this ruleset.',
    }
  )
}

function InfoTooltipLabel({
  description,
  label,
}: {
  description: string
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='cursor-help border-gray-500 border-b border-dashed'>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs whitespace-pre-line'>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  )
}
type Game = ParsedLogGame

type LogFileMeta = {
  fileName: string | null
  uploaderName: string | null
  fileUrl: string | null
  canReparseForDeckData: boolean
}

const FINAL_JOKER_CARD_WIDTH = 142
const FINAL_JOKER_EDITION_LABELS: Record<string, string> = {
  foil: 'Foil',
  holo: 'Holographic',
  holographic: 'Holographic',
  polychrome: 'Polychrome',
  negative: 'Negative',
  mp_phantom: 'Phantom',
}
const FINAL_JOKER_MODIFIER_LABELS: Record<string, string> = {
  eternal: 'Eternal',
  perishable: 'Perishable',
  rental: 'Rental',
}

function normalizeParsedGames(games: Game[]) {
  return games.map((game) => ({
    ...game,
    cocktailDecks: Array.isArray(game.cocktailDecks)
      ? game.cocktailDecks.filter((deck): deck is string => !!deck)
      : null,
    logOwnerDeck: normalizeDeckCards(game.logOwnerDeck),
    opponentDeck: normalizeDeckCards(game.opponentDeck),
  }))
}

function formatDeckShortName(value: string) {
  return value.replace(/ deck$/i, '').trim()
}

function canReparseForMissingDeckData(parsedJson: unknown) {
  if (!Array.isArray(parsedJson) || parsedJson.length === 0) {
    return false
  }

  return parsedJson.every((game) => {
    if (!game || typeof game !== 'object') {
      return false
    }

    return !('logOwnerDeck' in game) && !('opponentDeck' in game)
  })
}

// Helper to format duration
const formatDuration = (seconds: number | null): string => {
  if (seconds === null || seconds < 0) return 'N/A'
  if (seconds === 0) return '0s'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)

  return parts.join(' ')
}

// Helper to convert boolean strings
function boolStrToText(str: string | boolean | undefined | null): string {
  if (str === null || str === undefined) return 'Unknown'
  if (typeof str === 'boolean') return str ? 'Yes' : 'No'
  const lower = str.toLowerCase()
  if (lower === 'true') return 'Yes'
  if (lower === 'false') return 'No'
  return str
}

// Helper function to convert date strings to Date objects recursively
function convertDates<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertDates(item)) as unknown as T
  }

  const result: Record<string, unknown> = {
    ...(obj as Record<string, unknown>),
  }

  // Process each property
  for (const key in result) {
    const value = result[key]

    // Check if the value is a date string (ISO format)
    if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    ) {
      result[key] = new Date(value)
    }
    // Also handle date strings in the format used in the logs (YYYY-MM-DD HH:MM:SS)
    else if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)
    ) {
      result[key] = new Date(value)
    }
    // Recursively process nested objects and arrays
    else if (value && typeof value === 'object') {
      result[key] = convertDates(value)
    }
  }

  return result as T
}

function getGameTabValue(
  game: Pick<Game, 'id' | 'logOwnerName' | 'opponentName'>
) {
  return `game-${game.id}-${game.logOwnerName || 'LogOwner'}-vs-${game.opponentName || 'Opponent'}`
}

function formatFinalJokerModifier(token: string): string {
  const normalized = token.trim().toLowerCase()

  return (
    FINAL_JOKER_EDITION_LABELS[normalized] ??
    FINAL_JOKER_MODIFIER_LABELS[normalized] ??
    normalized
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  )
}

function parseFinalJoker(joker: string) {
  const [jokerNameRaw, editionRaw, modifierRaw, rentalRaw] = joker.split('-')
  const jokerName = jokerNameRaw?.trim()

  if (!jokerName) {
    return null
  }

  return {
    cleanName: jokers[jokerName]?.name ?? cleanJokerKey(jokerName),
    imageSrc: `/cards/${jokerName}.${jokerName === 'j_hologram' ? 'gif' : 'png'}`,
    tags: [editionRaw, modifierRaw, rentalRaw]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value && value !== 'none'))
      .map(formatFinalJokerModifier),
  }
}

function FinalJokerList({
  jokersList,
  slots,
}: {
  jokersList: string[]
  slots: number
}) {
  const normalizedSlots = Math.max(slots, jokersList.length, 1)
  const cardWidth = `min(${FINAL_JOKER_CARD_WIDTH}px, calc((100% - ${(normalizedSlots - 1) * 0.5}rem) / ${normalizedSlots}))`
  const seenJokers = new Map<string, number>()
  const jokerEntries = jokersList.flatMap((joker) => {
    const parsedJoker = parseFinalJoker(joker)
    if (!parsedJoker) {
      return []
    }

    const occurrence = (seenJokers.get(joker) ?? 0) + 1
    seenJokers.set(joker, occurrence)

    return [{ key: `${joker}-${occurrence}`, parsedJoker }]
  })

  return (
    <ul className='mt-3 flex gap-2'>
      {jokerEntries.map(({ key, parsedJoker }) => {
        return (
          <li
            key={key}
            className='min-w-0 list-none'
            style={{ width: cardWidth }}
          >
            <div className='flex w-full shrink-0 flex-col items-center gap-2 text-center'>
              <Image
                src={parsedJoker.imageSrc}
                alt={parsedJoker.cleanName}
                width={FINAL_JOKER_CARD_WIDTH}
                height={190}
                className='h-auto w-full'
              />
              <div className='flex min-h-12 flex-col items-center gap-1'>
                <span className='text-xs leading-tight md:text-sm'>
                  {parsedJoker.cleanName}
                </span>
                {parsedJoker.tags.length > 0 ? (
                  <div className='flex flex-wrap items-center justify-center gap-1'>
                    {parsedJoker.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant='outline'
                        className='rounded-full border-border/70 bg-muted/40 px-1.5 py-0 font-semibold text-[9px] tracking-[0.08em] md:px-2 md:text-[10px]'
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// Main component
export default function LogParser() {
  const formatter = useFormatter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const [parsedGames, setParsedGames] = useState<Game[]>([])
  const [logFileMeta, setLogFileMeta] = useState<LogFileMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isReparsingOriginalLog, setIsReparsingOriginalLog] = useState(false)
  const [isDownloadingOriginalLog, setIsDownloadingOriginalLog] =
    useState(false)
  const [activeTab, setActiveTab] = useState('')
  const canDownloadOriginalLog = hasPermission(
    session?.user,
    'logs.download_original'
  )

  const parseLogFile = async (file: File) => {
    setIsLoading(true)
    setError(null)
    setParsedGames([])
    setLogFileMeta(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/logs/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to upload log file')
      }

      const responseData = await response.json()
      setLogFileMeta({
        fileName: responseData.fileName ?? file.name,
        uploaderName:
          responseData.userName ??
          responseData.userEmail ??
          (responseData.userId ? 'Unknown user' : 'Anonymous'),
        fileUrl: responseData.fileUrl ?? null,
        canReparseForDeckData: false,
      })

      if (responseData.parsedGames && Array.isArray(responseData.parsedGames)) {
        const games = convertDates(responseData.parsedGames) as Game[]
        setParsedGames(normalizeParsedGames(games))
        if (games.length === 0) {
          setError('No games found in the log file.')
        }
      } else {
        setError('No games found in the log file.')
      }
    } catch (err) {
      console.error('Error parsing log:', err)
      setError(
        `Failed to parse log file. ${err instanceof Error ? err.message : 'Unknown error'}`
      )
      setParsedGames([])
    } finally {
      setIsLoading(false)
    }
  }

  const reparseOriginalLogFile = useCallback(async () => {
    const logId = searchParams.get('logId')

    if (!logId) {
      setError('Original uploaded log file is unavailable.')
      return
    }

    setIsReparsingOriginalLog(true)
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/logs/upload', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logFileId: Number.parseInt(logId, 10),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to reparse log file')
      }

      const data = await response.json()
      if (data.parsedGames && Array.isArray(data.parsedGames)) {
        const games = convertDates(data.parsedGames) as Game[]
        setParsedGames(normalizeParsedGames(games))
      }

      setLogFileMeta((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          canReparseForDeckData: false,
        }
      })
    } catch (err) {
      console.error('Error re-parsing original log:', err)
      setError(
        `Failed to re-parse original log file. ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    } finally {
      setIsReparsingOriginalLog(false)
      setIsLoading(false)
    }
  }, [searchParams])

  const downloadOriginalLogFile = useCallback(async () => {
    const fileUrl = logFileMeta?.fileUrl

    if (!canDownloadOriginalLog || !fileUrl) {
      return
    }

    setIsDownloadingOriginalLog(true)
    setError(null)

    try {
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error('Failed to fetch original uploaded log file')
      }

      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = logFileMeta?.fileName || 'balatro-mp.log'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(objectUrl)
    } catch (err) {
      console.error('Error downloading original log:', err)
      setError(
        `Failed to download original log file. ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    } finally {
      setIsDownloadingOriginalLog(false)
    }
  }, [canDownloadOriginalLog, logFileMeta?.fileName, logFileMeta?.fileUrl])

  // Check for logId query parameter and load the parsed data if it exists
  useEffect(() => {
    const logId = searchParams.get('logId')

    if (logId) {
      // If logId is provided, fetch the parsed data from the database
      setIsLoading(true)
      setError(null)
      setParsedGames([])
      setLogFileMeta(null)

      fetch(`/api/logs?id=${logId}`)
        .then((response) => {
          if (!response.ok) {
            throw new Error('Failed to fetch log file')
          }
          return response.json()
        })
        .then((data) => {
          setLogFileMeta({
            fileName: data.fileName ?? null,
            uploaderName:
              data.userName ??
              data.userEmail ??
              (data.userId ? 'Unknown user' : 'Anonymous'),
            fileUrl: data.fileUrl ?? null,
            canReparseForDeckData: canReparseForMissingDeckData(
              data.parsedJson
            ),
          })
          // Use the parsed JSON data directly from the database
          if (data.parsedJson && Array.isArray(data.parsedJson)) {
            const parsedGamesWithDates = convertDates(data.parsedJson) as Game[]
            setParsedGames(normalizeParsedGames(parsedGamesWithDates))
          } else {
            setError('No parsed games found in the log file.')
          }
          setIsLoading(false)
        })
        .catch((err) => {
          console.error('Error loading log file:', err)
          setError(`Failed to load log file: ${err.message}`)
          setIsLoading(false)
        })
    }
  }, [searchParams])

  useEffect(() => {
    if (parsedGames.length === 0) {
      setActiveTab('')
      return
    }

    const gameParam = Number.parseInt(searchParams.get('game') ?? '', 10)
    const nextIndex =
      Number.isInteger(gameParam) &&
      gameParam >= 0 &&
      gameParam < parsedGames.length
        ? gameParam
        : 0

    const nextGame = parsedGames[nextIndex] ?? parsedGames[0]
    if (!nextGame) {
      setActiveTab('')
      return
    }

    setActiveTab(getGameTabValue(nextGame))
  }, [parsedGames, searchParams])

  return (
    <TooltipProvider>
      <div
        className={
          'mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 pt-16'
        }
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (text.trim() && !isLoading) {
            e.preventDefault()
            parseLogFile(new File([text], 'paste.log', { type: 'text/plain' }))
          }
        }}
      >
        <Dropzone
          onDropAccepted={(files) => {
            const file = files[0]
            if (file instanceof File) {
              parseLogFile(file)
            }
          }}
          disabled={isLoading}
        >
          <DropzoneZone className={'w-full'}>
            <DropzoneInput />
            <DropzoneGroup className='gap-4'>
              <DropzoneUploadIcon />
              <DropzoneGroup>
                <DropzoneTitle>Drop log file here or click</DropzoneTitle>
                <DropzoneDescription>
                  Upload your logs file or paste log text anywhere on this page.
                </DropzoneDescription>
              </DropzoneGroup>
            </DropzoneGroup>
          </DropzoneZone>
        </Dropzone>

        {isLoading && <p>Loading and parsing log...</p>}
        {error && <p className='text-red-500'>{error}</p>}
        {logFileMeta && (
          <Card>
            <CardHeader>
              <CardTitle className='text-lg'>Log File</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-1'>
                <p className='font-medium text-muted-foreground text-sm'>
                  File Name
                </p>
                <p className='break-all font-medium'>
                  {logFileMeta.fileName || 'Unknown file'}
                </p>
              </div>
              <div className='space-y-1'>
                <p className='font-medium text-muted-foreground text-sm'>
                  Uploaded By
                </p>
                <p className='font-medium'>
                  {logFileMeta.uploaderName || 'Anonymous'}
                </p>
              </div>
              {canDownloadOriginalLog && logFileMeta.fileUrl ? (
                <div className='sm:col-span-2'>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={downloadOriginalLogFile}
                    disabled={isDownloadingOriginalLog}
                    className='w-full sm:w-auto'
                  >
                    <Download className='mr-2 size-4' />
                    {isDownloadingOriginalLog
                      ? 'Downloading original upload...'
                      : 'Download original upload'}
                  </Button>
                </div>
              ) : null}
              {logFileMeta.canReparseForDeckData &&
              searchParams.get('logId') ? (
                <div className='space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 sm:col-span-2'>
                  <div className='space-y-1'>
                    <p className='font-medium text-sm'>
                      This saved parse is missing deck snapshots.
                    </p>
                    <p className='text-muted-foreground text-sm'>
                      Re-parse the original uploaded log file to add deck
                      snapshots to this saved log.
                    </p>
                  </div>
                  <Button
                    type='button'
                    onClick={reparseOriginalLogFile}
                    disabled={isLoading || isReparsingOriginalLog}
                    className='w-full sm:w-auto'
                  >
                    {isReparsingOriginalLog
                      ? 'Re-parsing original upload...'
                      : 'Re-parse original upload and save deck snapshots'}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {parsedGames.length > 0 && (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className='flex flex-1 flex-col px-0 py-4 md:py-6'
          >
            <TabsList
              className={
                'grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
              }
            >
              {parsedGames.map((game) => {
                // Determine labels for the tab trigger, handling potential name conflicts
                const useGenericLabels =
                  game.logOwnerName &&
                  game.opponentName &&
                  game.logOwnerName === game.opponentName
                const opponentLabel = useGenericLabels
                  ? 'Opponent'
                  : game.opponentName || 'P2'

                return (
                  <TabsTrigger
                    key={`${game.id}-trigger`}
                    value={getGameTabValue(game)}
                  >
                    Game {game.id} vs{' '}
                    {game.winner === 'opponent'
                      ? `${opponentLabel} 🏆`
                      : opponentLabel}
                    {game.winner === 'logOwner' ? ' 🏆' : ''}
                  </TabsTrigger>
                )
              })}
            </TabsList>

            {parsedGames.map((game) => {
              // Determine labels for the content, handling potential name conflicts
              const useGenericLabels =
                game.logOwnerName &&
                game.opponentName &&
                game.logOwnerName === game.opponentName
              const ownerLabel = useGenericLabels
                ? 'Log Owner'
                : game.logOwnerName || 'Log Owner' // Fallback for display
              const opponentLabel = useGenericLabels
                ? 'Opponent'
                : game.opponentName || 'Opponent' // Fallback for display

              return (
                <TabsContent
                  key={`${game.id}-content`}
                  value={getGameTabValue(game)}
                  className='mt-4'
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        Game {game.id}: {ownerLabel} vs {opponentLabel}
                      </CardTitle>
                      <CardDescription>
                        Started:{' '}
                        {formatter.dateTime(
                          game.startDate instanceof Date
                            ? game.startDate
                            : new Date(game.startDate),
                          {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }
                        )}{' '}
                        | Ended:{' '}
                        {game.endDate
                          ? formatter.dateTime(
                              game.endDate instanceof Date
                                ? game.endDate
                                : new Date(game.endDate),
                              {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }
                            )
                          : 'N/A'}{' '}
                        | Duration: {formatDuration(game.durationSeconds)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                      {/* Column 1: Game Info & Events */}
                      <div className='flex flex-col gap-4'>
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              Game Details
                            </CardTitle>
                          </CardHeader>
                          <CardContent className='space-y-1 text-base'>
                            {/* Show Log Owner's Role */}
                            <p>
                              <strong>Log Owner's Role:</strong>{' '}
                              {game.isHost === null
                                ? 'Unknown'
                                : game.isHost
                                  ? 'Host'
                                  : 'Guest'}{' '}
                              ({ownerLabel})
                            </p>
                            {/* Show Winner */}
                            <p>
                              <strong>Winner:</strong>{' '}
                              {game.winner === null
                                ? 'Unknown'
                                : game.winner === 'logOwner'
                                  ? ownerLabel
                                  : opponentLabel}
                            </p>
                            <p>
                              <strong>{ownerLabel} Rerolls:</strong>{' '}
                              {game.rerolls || 'Unknown'}
                              {game.rerollCostTotal
                                ? ` (Cost: ${game.rerollCostTotal})`
                                : ''}
                            </p>
                            <p>
                              <strong>{opponentLabel} Rerolls:</strong>{' '}
                              {game.opponentRerolls || 'Unknown'}
                              {game.opponentRerollCostTotal
                                ? ` (Cost: ${game.opponentRerollCostTotal})`
                                : ''}
                            </p>
                            <p>
                              <strong>Deck:</strong> {(() => {
                                const deckInfo = getDeckInfo(
                                  game.deck,
                                  game.cocktailDecks
                                )
                                return (
                                  <InfoTooltipLabel
                                    label={deckInfo.name}
                                    description={deckInfo.description}
                                  />
                                )
                              })()}
                            </p>
                            <p>
                              <strong>Seed:</strong> {game.seed || 'Unknown'}
                            </p>
                            <p>
                              <strong>Lobby Code:</strong>{' '}
                              <span className='font-mono'>
                                {game.lobbyCode || 'Unknown'}
                              </span>
                            </p>
                            <p>
                              <strong>Ruleset:</strong> {(() => {
                                const rulesetInfo = getRulesetInfo(
                                  game.options?.ruleset
                                )

                                return (
                                  <InfoTooltipLabel
                                    label={rulesetInfo.name}
                                    description={rulesetInfo.description}
                                  />
                                )
                              })()}
                            </p>
                            <div className={'flex gap-1.5'}>
                              <strong>Stake:</strong>{' '}
                              {game.options?.stake && (
                                <div className={'flex items-center gap-1.5'}>
                                  {/*@ts-ignore*/}
                                  {STAKE_IMG[game.options.stake] && (
                                    <Image
                                      className={'size-5 shrink-0'}
                                      width={20}
                                      height={20}
                                      // @ts-expect-error
                                      src={STAKE_IMG[game.options.stake]}
                                      alt={'Stake'}
                                      unoptimized
                                    />
                                  )}
                                  {/*@ts-ignore*/}
                                  {STAKE[game.options?.stake] ?? 'Unknown'}
                                </div>
                              )}
                            </div>
                            <p>
                              <strong>Different Decks:</strong>{' '}
                              {boolStrToText(game.options?.different_decks)}
                            </p>
                            <p>
                              <strong>Different Seeds:</strong>{' '}
                              {boolStrToText(game.options?.different_seeds)}
                            </p>
                            <p>
                              <strong>Death on Round Loss:</strong>{' '}
                              {boolStrToText(game.options?.death_on_round_loss)}
                            </p>
                            <p>
                              <strong>Gold on Life Loss:</strong>{' '}
                              {boolStrToText(game.options?.gold_on_life_loss)}
                            </p>
                            <p>
                              <strong>No Gold on Round Loss:</strong>{' '}
                              {boolStrToText(
                                game.options?.no_gold_on_round_loss
                              )}
                            </p>
                          </CardContent>
                        </Card>
                        <DeckViewsCard
                          logOwnerDeck={game.logOwnerDeck}
                          opponentDeck={game.opponentDeck}
                          ownerLabel={ownerLabel}
                          opponentLabel={opponentLabel}
                          winner={game.winner}
                        />
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>Events</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ScrollArea className='h-[90vh]'>
                              <div className='space-y-2 pr-4'>
                                {game.events.map((event, index) => {
                                  return (
                                    // biome-ignore lint/suspicious/noArrayIndexKey: simple list
                                    <Fragment key={index}>
                                      <div
                                        // biome-ignore lint/suspicious/noArrayIndexKey: Simple list rendering
                                        key={index}
                                        className={`text-base ${getEventColor(event.type)} ${
                                          event.text.includes('Opponent')
                                            ? 'flex flex-row-reverse text-right'
                                            : 'flex'
                                        }`}
                                      >
                                        <span
                                          className={`${event.text.includes('Opponent') ? 'ml-2' : 'mr-2'} font-mono`}
                                        >
                                          {formatter.dateTime(
                                            event.timestamp instanceof Date
                                              ? event.timestamp
                                              : new Date(event.timestamp),
                                            {
                                              timeStyle: 'medium',
                                            }
                                          )}
                                        </span>
                                        <span>{event.text}</span>
                                      </div>
                                      {event.img && (
                                        <div
                                          className={`${event.text.includes('Opponent') ? 'flex justify-end' : ''}`}
                                        >
                                          <Image
                                            width={142}
                                            height={190}
                                            src={event.img}
                                            alt={event.img}
                                          />
                                        </div>
                                      )}
                                    </Fragment>
                                  )
                                })}
                              </div>
                            </ScrollArea>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Column 2: Money & Mods */}
                      <div className='flex flex-col gap-4'>
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              Shop Spending
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {/* Pass game and determined labels to the table */}
                            <ShopSpendingTable
                              game={game}
                              ownerLabel={ownerLabel}
                              opponentLabel={opponentLabel}
                            />
                          </CardContent>
                        </Card>
                        {/* PVP Blinds Card */}
                        <PvpBlindsCard
                          game={game}
                          ownerLabel={ownerLabel}
                          opponentLabel={opponentLabel}
                        />

                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>
                              Final Jokers
                            </CardTitle>
                          </CardHeader>
                          <CardContent className='space-y-3 text-sm'>
                            <div>
                              <strong>
                                {ownerLabel}
                                {game.winner === 'logOwner' ? ' 🏆' : ''}:
                              </strong>
                              {game.logOwnerFinalJokers.length > 0 ? (
                                <FinalJokerList
                                  jokersList={game.logOwnerFinalJokers}
                                  slots={Math.max(
                                    game.logOwnerFinalJokers.length,
                                    game.opponentFinalJokers.length,
                                    1
                                  )}
                                />
                              ) : (
                                <p className='text-gray-500 italic'>
                                  No data found.
                                </p>
                              )}
                            </div>
                            <div>
                              <strong>
                                {opponentLabel}
                                {game.winner === 'opponent' ? ' 🏆' : ''}:
                              </strong>
                              {game.opponentFinalJokers.length > 0 ? (
                                <FinalJokerList
                                  jokersList={game.opponentFinalJokers}
                                  slots={Math.max(
                                    game.logOwnerFinalJokers.length,
                                    game.opponentFinalJokers.length,
                                    1
                                  )}
                                />
                              ) : (
                                <p className='text-gray-500 italic'>
                                  No data found.
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>Vouchers</CardTitle>
                          </CardHeader>
                          <CardContent className='space-y-3 text-sm'>
                            <div>
                              <strong>
                                {ownerLabel}
                                {game.winner === 'logOwner' ? ' 🏆' : ''}:
                              </strong>
                              {game.logOwnerVouchers?.length > 0 ? (
                                <ul className='mt-3 ml-4 flex list-inside gap-3'>
                                  {game.logOwnerVouchers.map((voucher, i) => {
                                    if (!voucher) {
                                      return null
                                    }
                                    const cleanName =
                                      vouchers[voucher]?.name ??
                                      cleanVoucherKey(voucher)
                                    return (
                                      // biome-ignore lint/suspicious/noArrayIndexKey: Simple list
                                      <li key={i} className={'list-none'}>
                                        <div
                                          className={
                                            'flex flex-col items-center justify-center gap-2'
                                          }
                                        >
                                          <Image
                                            src={`/cards/${voucher}.png`}
                                            alt={cleanName}
                                            width={142}
                                            height={190}
                                          />
                                          <span>{cleanName}</span>
                                        </div>
                                      </li>
                                    )
                                  })}
                                </ul>
                              ) : (
                                <p className='text-gray-500 italic'>
                                  No data found.
                                </p>
                              )}
                            </div>
                            <div>
                              <strong>
                                {opponentLabel}
                                {game.winner === 'opponent' ? ' 🏆' : ''}:
                              </strong>
                              {game.opponentVouchers?.length > 0 ? (
                                <ul className='mt-3 ml-4 flex list-inside gap-3'>
                                  {game.opponentVouchers.map((voucher, i) => {
                                    if (!voucher) {
                                      return null
                                    }
                                    const cleanName =
                                      vouchers[voucher]?.name ??
                                      cleanVoucherKey(voucher)
                                    return (
                                      // biome-ignore lint/suspicious/noArrayIndexKey: Simple list
                                      <li key={i} className={'list-none'}>
                                        <div
                                          className={
                                            'flex flex-col items-center justify-center gap-2'
                                          }
                                        >
                                          <Image
                                            src={`/cards/${voucher}.png`}
                                            alt={cleanName}
                                            width={142}
                                            height={190}
                                          />
                                          <span>{cleanName}</span>
                                        </div>
                                      </li>
                                    )
                                  })}
                                </ul>
                              ) : (
                                <p className='text-gray-500 italic'>
                                  No data found.
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-lg'>Mods</CardTitle>
                          </CardHeader>
                          <CardContent className='space-y-2 text-base'>
                            <div>
                              <strong>
                                Host Mods ({game.host || 'Unknown'}):
                              </strong>
                              {game.hostMods.length > 0 ? (
                                <ul className='ml-4 list-inside list-disc font-mono text-base'>
                                  {game.hostMods.map((mod, i) => (
                                    // biome-ignore lint/suspicious/noArrayIndexKey: Simple list
                                    <li key={`host-mod-${i}`}>{mod}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className='text-gray-500 italic'>
                                  None detected
                                </p>
                              )}
                            </div>
                            <div>
                              <strong>
                                Guest Mods ({game.guest || 'Unknown'}):
                              </strong>
                              {game.guestMods.length > 0 ? (
                                <ul className='ml-4 list-inside list-disc font-mono text-base'>
                                  {game.guestMods.map((mod, i) => (
                                    // biome-ignore lint/suspicious/noArrayIndexKey: Simple list
                                    <li key={`guest-mod-${i}`}>{mod}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className='text-gray-500 italic'>
                                  None detected
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              )
            })}
          </Tabs>
        )}
      </div>
    </TooltipProvider>
  )
}

// --- Helper Functions ---

function ShopSpendingTable({
  game,
  ownerLabel,
  opponentLabel,
}: {
  game: Game
  ownerLabel: string
  opponentLabel: string
}) {
  const maxShops = Math.max(
    game.moneySpentPerShop.length,
    game.moneySpentPerShopOpponent.length
  )

  if (
    maxShops === 0 &&
    game.moneySpent === 0 &&
    game.opponentMoneySpent === 0
  ) {
    return (
      <p className='text-gray-500 text-sm italic'>
        No shop spending data recorded.
      </p>
    )
  }

  return (
    <div className='overflow-hidden rounded-lg border bg-background'>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-background'>
            <TableRow className='bg-muted/50'>
              <TableHead className='w-15 text-right font-mono'>Shop</TableHead>
              <TableHead className='text-right font-mono'>
                {ownerLabel}
                {game.winner === 'logOwner' ? ' 🏆' : ''}
              </TableHead>
              <TableHead className='text-right font-mono'>
                {opponentLabel}
                {game.winner === 'opponent' ? ' 🏆' : ''}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: maxShops }).map((_, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Simple table rendering
              <TableRow key={j}>
                <TableCell className='text-right font-mono'>{j + 1}</TableCell>
                <TableCell className='text-right font-mono'>
                  {game.moneySpentPerShop[j] === null
                    ? 'Skipped'
                    : game.moneySpentPerShop[j] !== undefined
                      ? `$${game.moneySpentPerShop[j]}`
                      : '-'}
                </TableCell>
                <TableCell className='text-right font-mono'>
                  {game.moneySpentPerShopOpponent[j] === null
                    ? 'Skipped'
                    : game.moneySpentPerShopOpponent[j] !== undefined
                      ? `$${game.moneySpentPerShopOpponent[j]}`
                      : '-'}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className='font-bold'>
              <TableCell>Total Reported</TableCell>
              <TableCell className='text-right font-mono'>
                $
                {game.moneySpentPerShop
                  .filter((v): v is number => v !== null)
                  .reduce((a, b) => a + b, 0)}
              </TableCell>
              <TableCell className='text-right font-mono'>
                $
                {game.moneySpentPerShopOpponent
                  .filter((v): v is number => v !== null)
                  .reduce((a, b) => a + b, 0)}
              </TableCell>
            </TableRow>
            <TableRow className='border-t-2 font-bold'>
              <TableCell>Total Actual</TableCell>
              <TableCell className='text-right font-mono'>
                <Tooltip>
                  <TooltipTrigger className='cursor-help border-gray-500 border-b border-dashed'>
                    ${game.moneySpent}
                  </TooltipTrigger>
                  <TooltipContent>
                    Sum of money {ownerLabel} spent via buy/reroll actions
                    detected in this log.
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className='text-right font-mono'>
                <Tooltip>
                  <TooltipTrigger className='cursor-help border-gray-500 border-b border-dashed'>
                    ${game.opponentMoneySpent}
                  </TooltipTrigger>
                  <TooltipContent>
                    Sum of money {opponentLabel} reported spending via network
                    messages received by {ownerLabel}.
                  </TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function getEventColor(type: LogEvent['type']): string {
  switch (type) {
    case 'event':
      return 'text-blue-400'
    case 'status':
      return 'text-green-400'
    case 'system':
      return 'text-purple-400'
    case 'shop':
      return 'text-yellow-400'
    case 'action':
      return 'text-cyan-400'
    case 'info':
      return 'text-gray-400'
    case 'error':
      return 'text-red-500'
    default:
      return 'text-gray-500'
  }
}

function cleanJokerKey(key: string): string {
  if (!key) return ''
  return key
    .trim()
    .replace(/^j_mp_|^j_/, '') // Remove prefixes j_mp_ or j_
    .replace(/_/g, ' ') // Replace underscores with spaces
    .replace(
      /\w\S*/g, // Capitalize each word (Title Case)
      (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    )
}

function cleanVoucherKey(key: string): string {
  if (!key) return ''
  return key
    .trim()
    .replace(/^v_/, '') // Remove prefix v_
    .replace(/_/g, ' ') // Replace underscores with spaces
    .replace(
      /\w\S*/g, // Capitalize each word (Title Case)
      (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    )
}
