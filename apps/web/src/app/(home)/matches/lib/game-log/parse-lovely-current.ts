import type { LogEventTuple } from '../decode-replay-log'

// Reads a raw Lovely log written by the current mods (API 1.0 / PvP 1.0) back
// into the same [t, opcode, args] tuples a server replay log holds, so one
// builder (build-game-log.ts) renders both.
//
// The carbon stream the recorder tees into the log ("MP_RLOG: <t> <opcode>
// <tokens>", api/replay/recorder.lua fmt_args) is positional text and lossy:
//   - dict payloads (match_manifest, lobby_info, run_info, hand_scored,
//     life_lost) print nothing;
//   - a nested list prints as "table: 0x...", so the card refs of play /
//     discard / reorder / pack_skip and use targets are gone (their hand
//     positions survive);
//   - a single card ref survives, dot-joined: "-16.Booster.p_buffoon_normal_2"
//     (first sight: -id.kind.ident[.tag...]; seen before: id[.tag...]).
// The human stream ("Client sent message: action:...") adds the blind key,
// and IDOL_ROLL:: lines carry each idol roll. Anything the text cannot say is
// left out rather than guessed.

export interface LovelyGame {
  /** 1-based position in the file. */
  index: number
  /** ISO timestamp from the "Game starting" line, when present. */
  startedAt: string | null
  mod: string | null
  gamemode: string | null
  events: LogEventTuple[]
}

export interface LovelyParse {
  games: LovelyGame[]
  /** IDOL_ROLL payloads seen outside any game. */
  orphanIdolRolls: unknown[]
}

const CARBON = /MP_RLOG: (END|CHK|\d+)(?: (.*))?$/
const HUMAN = /Client sent message: (.*)$/
const GAME_START = /Game starting — (\S+)/
const QUEUE = /matchmaking\.queue mod=(\S+) gameMode=(\S+)/
const IDOL = 'IDOL_ROLL::'

export function isCurrentLovelyLog(text: string): boolean {
  return text.includes('MP_RLOG:')
}

// "-16.Booster.p_buffoon_normal_2" -> [-16, 'Booster', 'p_buffoon_normal_2'];
// "24" -> [24]. Anything unreadable (an empty token, "table: 0x...") -> null.
export function parseRefToken(token: string | undefined): unknown[] | null {
  if (!token || token.startsWith('table:')) return null
  const parts = token.split('.')
  const id = Number(parts[0])
  if (!Number.isInteger(id) || id === 0) return null
  return [id, ...parts.slice(1)]
}

// A list of card refs joined with "," (see the API's fmt_args). Older logs
// printed "table: 0x..." here; those yield no refs.
function refList(token: string | undefined): unknown[][] {
  if (!token || token.startsWith('table:')) return []
  return token
    .split(',')
    .map(parseRefToken)
    .filter((ref): ref is unknown[] => ref !== null)
}

function words(token: string | undefined): string[] {
  return token ? token.split('.').filter(Boolean) : []
}

function numbers(token: string | undefined): number[] {
  if (!token || token.startsWith('table:')) return []
  return token
    .split('.')
    .map(Number)
    .filter((n) => Number.isFinite(n))
}

function num(token: string | undefined): number | null {
  if (token === undefined || token === '') return null
  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

function decodeIdol(payload: string): unknown | null {
  try {
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

function argsFor(opcode: string, tokens: string[]): unknown {
  switch (opcode) {
    case 'select_blind':
      return tokens[1] ? [0, tokens[1]] : [0]
    case 'skip_blind':
      return [0]
    case 'set_ante_key':
      return [tokens[0] ?? '']
    case 'hand_result':
      return [tokens[0] ?? '0', num(tokens[1])]
    case 'play':
    case 'discard':
      // [positions, card refs, owned jokers (play only, newer mods)]
      // Older logs print a nested list as "table: 0x..." (with spaces), so
      // anything after a "table:" token is that noise, not a joker snapshot.
      return tokens[2] !== undefined && !tokens[1]?.startsWith('table:')
        ? [numbers(tokens[0]), refList(tokens[1]), words(tokens[2])]
        : [numbers(tokens[0]), refList(tokens[1])]
    case 'idol_roll':
      return [num(tokens[0]), tokens[1] ?? '', words(tokens[2])]
    case 'deck_snapshot':
      return [words(tokens[0])]
    case 'reorder':
      return [num(tokens[0]), numbers(tokens[1]), []]
    case 'buy':
    case 'open_pack':
    case 'voucher':
      return [
        num(tokens[0]),
        num(tokens[1]),
        parseRefToken(tokens[2]),
        num(tokens[3]),
      ]
    case 'sell':
      return [num(tokens[0]), num(tokens[1]), parseRefToken(tokens[2])]
    case 'use':
    case 'pack_pick':
      return [
        num(tokens[0]),
        numbers(tokens[1]),
        parseRefToken(tokens[2]),
        refList(tokens[3]),
      ]
    case 'pack_skip':
      return [refList(tokens[0])]
    case 'money_delta':
    case 'round_dollars':
    case 'ready_blind':
      return [num(tokens[0])]
    case 'life_lost':
      return { lost: 1 }
    case 'reroll':
    case 'cashout':
    case 'leave_shop':
    case 'hand_scored':
      return null
    default:
      return tokens.length > 0 ? tokens : null
  }
}

export function parseCurrentLovelyLog(text: string): LovelyParse {
  const games: LovelyGame[] = []
  const orphanIdolRolls: unknown[] = []
  let current: LovelyGame | null = null
  let lastT = 0
  let queuedMod: string | null = null
  let queuedMode: string | null = null

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue

    const queue = QUEUE.exec(line)
    if (queue) {
      queuedMod = queue[1] ?? null
      queuedMode = queue[2] ?? null
      continue
    }

    const start = GAME_START.exec(line)
    if (start) {
      current = {
        index: games.length + 1,
        startedAt: start[1] ?? null,
        mod: queuedMod,
        gamemode: queuedMode,
        events: [],
      }
      games.push(current)
      lastT = 0
      continue
    }

    const idolAt = line.indexOf(IDOL)
    if (idolAt !== -1) {
      const payload = decodeIdol(
        line
          .slice(idolAt + IDOL.length)
          .trim()
          .split(/\s+/)[0] ?? ''
      )
      if (payload === null) continue
      if (current) {
        const roll = (payload as { roll?: unknown }).roll
        const seen = current.events.some(
          (e) => e[1] === 'idol_roll' && Array.isArray(e[2]) && e[2][0] === roll
        )
        if (!seen) current.events.push([lastT, 'idol_roll', payload])
      } else orphanIdolRolls.push(payload)
      continue
    }

    if (!current) continue

    const carbon = CARBON.exec(line)
    if (carbon) {
      const head = carbon[1] as string
      const rest = carbon[2] ?? ''
      if (head === 'CHK') continue
      if (head === 'END') {
        try {
          current.events.push([lastT, 'end', JSON.parse(rest)])
        } catch {
          current.events.push([lastT, 'end', {}])
        }
        continue
      }
      const sp = rest.indexOf(' ')
      const opcode = sp === -1 ? rest : rest.slice(0, sp)
      const tokens = sp === -1 ? [] : rest.slice(sp + 1).split(' ')
      lastT = Number(head)
      const args = argsFor(opcode, tokens)
      // The IDOL_ROLL debug line may already have recorded this roll.
      if (
        opcode === 'idol_roll' &&
        current.events.some(
          (e) =>
            e[1] === 'idol_roll' &&
            !Array.isArray(e[2]) &&
            (e[2] as { roll?: unknown } | null)?.roll === (args as unknown[])[0]
        )
      ) {
        continue
      }
      current.events.push([lastT, opcode, args])
      continue
    }

    const human = HUMAN.exec(line)
    if (human) {
      const blind = /action:selectBlind,blind:([\w]+)/.exec(human[1] ?? '')
      if (blind) {
        // The select_blind line just before this one gets its blind key.
        for (let i = current.events.length - 1; i >= 0; i--) {
          const event = current.events[i] as LogEventTuple
          if (event[1] === 'select_blind') {
            event[2] = [0, blind[1]]
            break
          }
        }
      }
    }
  }

  for (const game of games) {
    game.events.unshift(
      [
        0,
        'match_manifest',
        {
          mod_id: game.mod ?? 'MultiplayerPvP',
          start_epoch_ms: game.startedAt
            ? Date.parse(game.startedAt) || null
            : null,
        },
      ],
      [0, 'lobby_info', { gamemode: game.gamemode ?? undefined }]
    )
  }

  return { games, orphanIdolRolls }
}
