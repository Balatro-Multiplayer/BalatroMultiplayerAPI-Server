'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { GameLogView } from '../matches/components/game-log/game-log-view'
import { IdolTrack } from '../matches/components/game-log/idol-track'
import type { DecodedPlayerLog } from '../matches/lib/decode-player-logs'
import { buildGameLog } from '../matches/lib/game-log/build-game-log'
import {
  isCurrentLovelyLog,
  type LovelyGame,
  parseCurrentLovelyLog,
} from '../matches/lib/game-log/parse-lovely-current'
import { parseLovelyIdolRolls } from '../matches/lib/game-log/parse-lovely-idol'
import { parseReplayUpload } from '../matches/lib/game-log/parse-upload'
import type { GameLog, IdolRoll } from '../matches/lib/game-log/types'
import { LegacyGamesView } from './_legacy/legacy-game-view'
import { type ParsedLogGame, parseLogSource } from './_legacy/log-source-parser'

const fileLabel = (name: string) => name.replace(/\.[^.]+$/, '')

interface LogView {
  id: string
  label: string
  log: GameLog
}

// Public, client-only: files are read and parsed in the browser and never
// sent anywhere. Accepted inputs, tried in this order per file:
//   1. an exported / server replay log ([t, opcode, args] events)
//   2. a raw Lovely log from the current mods (MP_RLOG: lines)
//   3. a raw Lovely log from the older 0.5.x mod (legacy report)
//   4. any log with IDOL_ROLL lines (idol rolls only)
export default function LogParserPage() {
  const [views, setViews] = useState<LogView[]>([])
  const [selected, setSelected] = useState(0)
  const [legacyGames, setLegacyGames] = useState<ParsedLogGame[]>([])
  const [idolRolls, setIdolRolls] = useState<IdolRoll[]>([])
  const [error, setError] = useState<string | null>(null)

  async function onFiles(files: FileList | null) {
    setError(null)
    if (!files || files.length === 0) return

    const replayLogs: DecodedPlayerLog[] = []
    const nextViews: LogView[] = []
    const games: ParsedLogGame[] = []
    const rolls: IdolRoll[] = []
    const lovelyGames: { file: string; game: LovelyGame }[] = []

    for (const file of Array.from(files)) {
      const text = await file.text()

      const replay = parseReplayUpload(text, file.name)
      if (replay) {
        for (const entry of replay) {
          // Two uploads with the same name (or ids) must stay separate players.
          let id = entry.playerId
          for (let n = 2; replayLogs.some((l) => l.playerId === id); n++) {
            id = `${entry.playerId} (${n})`
          }
          replayLogs.push({ ...entry, playerId: id })
        }
        continue
      }

      if (isCurrentLovelyLog(text)) {
        const parsed = parseCurrentLovelyLog(text)
        for (const game of parsed.games) {
          if (game.events.length > 2)
            lovelyGames.push({ file: file.name, game })
        }
        if (parsed.games.length > 0) continue
      }

      const legacy = await parseLogSource(text).catch(() => [])
      if (legacy.length > 0) {
        games.push(...legacy)
        continue
      }

      const found = parseLovelyIdolRolls(text)
      if (found.length > 0) {
        rolls.push(...found)
        continue
      }

      setError(`${file.name} is not a log this page can read.`)
      setViews([])
      setLegacyGames([])
      setIdolRolls([])
      return
    }

    // Logs from different players' clients that started the same game (same
    // "Game starting" time) are one match: show them side by side.
    const used = new Set<{ file: string; game: LovelyGame }>()
    for (const entry of lovelyGames) {
      if (used.has(entry)) continue
      const sameGame = lovelyGames.filter(
        (other) =>
          entry.game.startedAt !== null &&
          other.game.startedAt === entry.game.startedAt &&
          !used.has(other)
      )
      const distinct = sameGame.filter(
        (other, i) => sameGame.findIndex((o) => o.file === other.file) === i
      )
      const group = distinct.length > 1 ? distinct : [entry]
      for (const member of group) used.add(member)
      const time = entry.game.startedAt
        ? ` · ${entry.game.startedAt.slice(11, 16)}`
        : ''
      nextViews.push({
        id: `${entry.file}-${entry.game.index}`,
        label:
          group.length > 1
            ? `Match${time} · ${group.map((m) => fileLabel(m.file)).join(' vs ')}`
            : `${files.length > 1 ? `${entry.file} · ` : ''}Game ${entry.game.index}${time}`,
        log: buildGameLog(
          group.map((m) => ({
            playerId: group.length > 1 ? fileLabel(m.file) : 'You',
            events: m.game.events,
          }))
        ),
      })
    }

    if (replayLogs.length > 0) {
      nextViews.unshift({
        id: 'replay',
        label: 'Replay log',
        log: buildGameLog(replayLogs),
      })
    }

    setViews(nextViews)
    setSelected(0)
    setLegacyGames(games.map((g, i) => ({ ...g, id: i + 1 })))
    setIdolRolls(rolls)
  }

  const view = views[selected] ?? views[0]

  return (
    <div className='container max-w-6xl space-y-6 py-8'>
      <div className='space-y-1'>
        <h1 className='font-bold text-2xl tracking-tight'>Log Parser</h1>
        <p className='text-muted-foreground text-sm'>
          Read a Lovely log from the game, or a replay log export, as a
          round-by-round game log. Files stay in your browser. For a replay
          export, select one file per player to compare both sides.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Log file</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          <Input
            type='file'
            multiple
            accept='.json,.txt,.log,.jsonl'
            onChange={(e) => onFiles(e.target.files)}
          />
          {error && <p className='text-destructive text-sm'>{error}</p>}
        </CardContent>
      </Card>

      {views.length > 1 && (
        <div className='flex flex-wrap gap-2'>
          {views.map((v, i) => (
            <Button
              key={v.id}
              size='sm'
              variant={i === selected ? 'default' : 'outline'}
              onClick={() => setSelected(i)}
            >
              {v.label}
            </Button>
          ))}
        </div>
      )}

      {view && (
        <GameLogView
          log={view.log}
          playerLabel={(id) => <span className='break-all'>{id}</span>}
        />
      )}

      {legacyGames.length > 0 && <LegacyGamesView games={legacyGames} />}

      {idolRolls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>
              Idol rolls ({idolRolls.length})
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {idolRolls.map((roll, i) => (
              <div key={`${roll.t}-${roll.winner}`} className='space-y-1'>
                <p className='text-muted-foreground text-xs'>Roll {i + 1}</p>
                <IdolTrack roll={roll} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
