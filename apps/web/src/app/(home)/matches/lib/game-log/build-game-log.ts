import type { ResolvedCard } from '../card-ref'
import { isRawRef, resolveCardRef } from '../card-ref'
import type { DecodedPlayerLog } from '../decode-player-logs'
import { findMatchInfo } from '../manifest'
import { isPlainRecord } from '../plain-record'
import { buildTimeline } from '../timeline'
import { compareScoreText, scoreGain, scoreNumber } from './score'
import type {
  GameEvent,
  GameLog,
  IdolRollCard,
  PlayerGameLog,
  PvpRoundResult,
  RoundLog,
  ShopAction,
} from './types'

// MPAPI.replay.AREA (api/replay/area_utils.lua)
const AREA_JOKERS = 4

const SLOT_LABELS = ['Small Blind', 'Big Blind', 'Boss / PvP Blind'] as const

const BOSSES_WITHOUT_THE = new Set([
  'amber_acorn',
  'verdant_leaf',
  'violet_vessel',
  'crimson_heart',
  'cerulean_bell',
])

export function blindName(key: string): string {
  if (key === 'bl_small') return 'Small Blind'
  if (key === 'bl_big') return 'Big Blind'
  if (key === 'bl_mp_nemesis') return 'PvP Blind'
  const bare = key.replace(/^bl_(mp_)?/, '')
  const title = bare
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return BOSSES_WITHOUT_THE.has(bare) ? title : `The ${title}`
}

type Resolved = { id: number; card: ResolvedCard }

// Per-player ref resolver. A ref repeats its tags on every reference
// (enhancement/edition/seal can change mid-run), so an already-seen ref is
// returned with ITS tags, not the first-seen card's.
function makeResolver() {
  const registry = new Map<number, ResolvedCard>()
  return (ref: unknown): Resolved | null => {
    if (!isRawRef(ref)) return null
    const first = ref[0] as number
    if (first < 0) {
      const card = resolveCardRef(ref, registry)
      return card ? { id: -first, card } : null
    }
    const base = registry.get(first)
    if (!base) return null
    return { id: first, card: { ...base, tags: ref.slice(1) as string[] } }
  }
}

function resolveAll(
  refs: unknown,
  resolve: (ref: unknown) => Resolved | null
): Resolved[] {
  if (!Array.isArray(refs)) return []
  return refs.map(resolve).filter((r): r is Resolved => r !== null)
}

function isJoker(card: ResolvedCard): boolean {
  return (
    card.type === 'other_card' && (card.kind === 'Joker' || card.kind === 'j')
  )
}

// "j_blueprint|foil" -> a joker card; the mod records these as plain strings.
export function parseJokerTokens(tokens: unknown): ResolvedCard[] {
  if (!Array.isArray(tokens)) return []
  return tokens.flatMap((token): ResolvedCard[] => {
    if (typeof token !== 'string' || token === '') return []
    const [key = '', edition] = token.split('|')
    return [
      {
        type: 'other_card',
        kind: 'Joker',
        ident: key,
        tags: edition ? [`ed:${edition}`] : [],
      },
    ]
  })
}

const SUIT_NAME: Record<string, string> = {
  H: 'Hearts',
  D: 'Diamonds',
  C: 'Clubs',
  S: 'Spades',
}
const RANK_NAME: Record<string, string> = {
  A: 'Ace',
  K: 'King',
  Q: 'Queen',
  J: 'Jack',
  T: '10',
}

// "SA|e:m_glass|ed:foil" -> a playing card (suit initial + rank, then tags).
export function parseDeckTokens(tokens: unknown): ResolvedCard[] {
  if (!Array.isArray(tokens)) return []
  return tokens.flatMap((token): ResolvedCard[] => {
    if (typeof token !== 'string') return []
    const [face = '', ...tags] = token.split('|')
    const suit = SUIT_NAME[face.charAt(0)]
    const rankCode = face.slice(1)
    const value = RANK_NAME[rankCode] ?? rankCode
    if (!suit || value === '') return []
    return [{ type: 'playing_card', suit, value, tags }]
  })
}

const IDOL_TOKEN = /^(10|[2-9TJQKA])([HDCS])(\d+)$/

export function parseIdolTokens(tokens: unknown): IdolRollCard[] {
  if (!Array.isArray(tokens)) return []
  const cards: IdolRollCard[] = []
  for (const token of tokens) {
    const match = typeof token === 'string' ? IDOL_TOKEN.exec(token) : null
    if (match) {
      cards.push({
        rank: match[1] === 'T' ? '10' : (match[1] as string),
        suit: match[2] as string,
        count: Number(match[3]),
      })
    }
  }
  return cards
}

interface RoundDraft extends RoundLog {
  lastScore: string | null
}

function newRound(
  index: number,
  entry: RoundLog['entry'],
  t: number,
  blindKey: string | null = null
): RoundDraft {
  const ordinal = entry === 'setup' ? 0 : index - 1
  const slot = (ordinal % 3) as 0 | 1 | 2
  const ante = Math.floor(ordinal / 3) + 1
  const name = blindKey ? blindName(blindKey) : SLOT_LABELS[slot]
  const label =
    entry === 'setup'
      ? 'Before the first blind'
      : `Ante ${ante} · ${name}${entry === 'skipped' ? ' (skipped)' : ''}`
  return {
    kind: 'blind',
    index,
    ante,
    slot,
    label,
    entry,
    blindKey,
    isPvp: blindKey
      ? blindKey === 'bl_mp_nemesis'
      : entry !== 'setup' && slot === 2,
    anteKey: null,
    startT: t,
    endT: t,
    events: [],
    finalScore: null,
    handsPlayed: 0,
    discards: 0,
    moneyGained: 0,
    moneySpent: 0,
    shopSpent: 0,
    shopRerolls: 0,
    lastScore: null,
  }
}

// The shop between a blind and the next one. It exists for every blind that
// was cashed out, so each Idol roll has a guaranteed home at the top of one.
function newShop(blind: RoundDraft, t: number): RoundDraft {
  const name = blind.blindKey
    ? blindName(blind.blindKey)
    : SLOT_LABELS[blind.slot]
  return {
    ...newRound(blind.index, 'selected', t),
    kind: 'shop',
    index: blind.index + 0.5,
    ante: blind.ante,
    slot: blind.slot,
    label: `Ante ${blind.ante} · Shop after ${name}`,
    isPvp: false,
    anteKey: blind.anteKey,
  }
}

const SHOP_OPCODES = new Set([
  'buy',
  'open_pack',
  'voucher',
  'sell',
  'reroll',
  'use',
  'pack_pick',
  'pack_skip',
])

export function buildPlayerGameLog(log: DecodedPlayerLog): PlayerGameLog {
  const resolve = makeResolver()
  const events = log.events

  const rounds: RoundDraft[] = []
  let current = newRound(0, 'setup', 0)
  rounds.push(current)

  let jokers: Resolved[] = []
  const vouchers: ResolvedCard[] = []
  let seed: string | null = null
  let deck: string | null = null
  let stake: number | null = null
  let result: string | null = null
  let livesLost = 0
  let rerolls = 0
  let itemizedPurchases = 0
  let pendingDollars: number | null = null
  let sawBlind = false
  let blindOrdinal = 0
  // Idol rolls are logged when a blind ends but apply to the next blind played:
  // held until the shop opens (then shown first in it), or, for the roll made
  // before the first blind, carried into that blind.
  let heldIdols: GameEvent[] = []
  const carriedIdols: GameEvent[] = []
  let finalDeck: ResolvedCard[] = []
  const consumedMoney = new Set<number>()

  const push = (event: GameEvent) => {
    current.events.push(event)
  }

  for (let i = 0; i < events.length; i++) {
    const [t, opcode, args] = events[i] as [number, string, unknown]
    current.endT = t
    const a = Array.isArray(args) ? args : []

    // Cost of the action = the negative money_delta that follows it.
    const followingSpend = (): number | null => {
      const next = events[i + 1]
      if (
        next &&
        next[1] === 'money_delta' &&
        typeof (Array.isArray(next[2]) ? next[2][0] : next[2]) === 'number'
      ) {
        const delta = (Array.isArray(next[2]) ? next[2][0] : next[2]) as number
        if (delta < 0) {
          consumedMoney.add(i + 1)
          return -delta
        }
      }
      return null
    }

    switch (opcode) {
      case 'run_info':
        if (isPlainRecord(args)) {
          if (typeof args.seed === 'string') seed = args.seed
          if (typeof args.deck === 'string') deck = args.deck
          if (typeof args.stake === 'number') stake = args.stake
        }
        break

      case 'end':
        if (isPlainRecord(args) && typeof args.result === 'string') {
          result = args.result
        }
        break

      case 'select_blind':
      case 'skip_blind': {
        sawBlind = true
        current = newRound(
          ++blindOrdinal,
          opcode === 'select_blind' ? 'selected' : 'skipped',
          t,
          typeof a[1] === 'string' ? a[1] : null
        )
        if (opcode === 'select_blind') {
          current.events.push(...carriedIdols.splice(0))
        }
        rounds.push(current)
        break
      }

      case 'set_ante_key':
        if (typeof a[0] === 'string' || typeof args === 'string') {
          current.anteKey = String(typeof args === 'string' ? args : a[0])
        }
        break

      case 'play':
      case 'discard': {
        const cards = resolveAll(a[1], resolve).map((r) => r.card)
        const jokerSnapshot =
          opcode === 'play' && (Array.isArray(a[2]) || isPlainRecord(a[2]))
            ? parseJokerTokens(a[2])
            : null
        if (opcode === 'play') current.handsPlayed++
        else current.discards++
        push({
          type: 'hand',
          t,
          kind: opcode,
          cards,
          positions: Array.isArray(a[0])
            ? (a[0] as unknown[]).filter(
                (n): n is number => typeof n === 'number'
              )
            : [],
          roundScore: null,
          handScore: null,
          handsLeft: null,
          // A play records the jokers owned at that moment (newer mods);
          // older logs fall back to the buy/sell/reorder reconstruction.
          jokers:
            opcode === 'play' && jokerSnapshot
              ? jokerSnapshot
              : jokers.map((j) => j.card),
        })
        break
      }

      case 'hand_result': {
        const text = a[0] === undefined || a[0] === null ? null : String(a[0])
        const left = typeof a[1] === 'number' ? a[1] : null
        const last = [...current.events]
          .reverse()
          .find((e) => e.type === 'hand' && e.roundScore === null)
        if (last && last.type === 'hand') {
          last.roundScore = text
          last.handsLeft = left
          if (last.kind === 'play' && last.handScore === null) {
            last.handScore = scoreGain(current.lastScore, text)
          }
        }
        if (text !== null) {
          current.lastScore = text
          if (scoreNumber(text) !== 0) current.finalScore = text
        }
        break
      }

      case 'hand_scored': {
        // Newer logs carry each hand's own score; older ones only the
        // blind's running total (hand_result).
        const raw = isPlainRecord(args) ? args.score : a[0]
        const score = raw === undefined || raw === null ? null : String(raw)
        const lastPlay = [...current.events]
          .reverse()
          .find((e) => e.type === 'hand' && e.kind === 'play')
        if (score !== null && lastPlay && lastPlay.type === 'hand') {
          lastPlay.handScore = score
        }
        break
      }

      case 'deck_snapshot':
        finalDeck = parseDeckTokens(a[0])
        break

      case 'leave_shop':
        push({ type: 'leave_shop', t })
        break

      case 'life_lost': {
        const lost =
          isPlainRecord(args) && typeof args.lost === 'number' ? args.lost : 1
        const lives =
          isPlainRecord(args) && typeof args.lives === 'number'
            ? args.lives
            : null
        livesLost += lost
        push({ type: 'life_lost', t, lost, lives })
        break
      }

      case 'ready_blind':
        push({
          type: 'ready',
          t,
          ready: (Array.isArray(args) ? a[0] : args) === 1,
        })
        break

      case 'round_dollars': {
        const v = Array.isArray(args) ? a[0] : args
        pendingDollars = typeof v === 'number' ? v : null
        break
      }

      case 'cashout': {
        push({ type: 'cashout', t, dollars: pendingDollars })
        pendingDollars = null
        if (current.kind === 'blind' && current.entry !== 'setup') {
          current = newShop(current, t)
          current.events.push(...heldIdols)
          heldIdols = []
          rounds.push(current)
        }
        break
      }

      case 'money_delta': {
        if (consumedMoney.has(i)) break
        const v = Array.isArray(args) ? a[0] : args
        if (typeof v === 'number') push({ type: 'money', t, delta: v })
        break
      }

      case 'reorder': {
        const perm = a[1]
        resolveAll(
          Array.isArray(a[2]) ? (a[2] as unknown[][]).map((m) => m[0]) : [],
          resolve
        )
        if (a[0] === AREA_JOKERS && Array.isArray(perm)) {
          const next = (perm as number[]).map((from) => jokers[from - 1])
          if (next.length === jokers.length && next.every(Boolean)) {
            jokers = next as Resolved[]
          }
        }
        break
      }

      case 'idol_roll': {
        let idol: GameEvent | null = null
        if (Array.isArray(args)) {
          // Positional form: [roll, winner, cards]
          idol = {
            type: 'idol',
            t,
            appliesTo: null,
            jokers: jokers.map((j) => j.card),
            roll: typeof a[0] === 'number' ? a[0] : null,
            winner: typeof a[1] === 'string' ? a[1] : '',
            cards: parseIdolTokens(a[2]),
          }
        } else if (isPlainRecord(args)) {
          idol = {
            type: 'idol',
            t,
            appliesTo: null,
            jokers: jokers.map((j) => j.card),
            roll: typeof args.roll === 'number' ? args.roll : 0,
            winner: typeof args.winner === 'string' ? args.winner : '',
            cards: parseIdolTokens(args.cards),
          }
        }
        if (!idol) break
        if (current.kind === 'shop') current.events.unshift(idol)
        else if (current.entry === 'setup') carriedIdols.push(idol)
        else heldIdols.push(idol)
        break
      }

      default:
        if (SHOP_OPCODES.has(opcode)) {
          handleShop(opcode as ShopAction)
        } else if (
          !['match_manifest', 'lobby_info', 'chk', 'money_delta'].includes(
            opcode
          )
        ) {
          push({ type: 'other', t, opcode, args })
        }
    }

    function handleShop(initial: ShopAction) {
      let action = initial
      let card: ResolvedCard | null = null
      let targets: ResolvedCard[] = []
      let cost: number | null = null
      let area: number | null = null

      if (
        action === 'buy' ||
        action === 'open_pack' ||
        action === 'voucher' ||
        action === 'sell'
      ) {
        area = typeof a[0] === 'number' ? a[0] : null
        const r = resolve(a[2])
        card = r?.card ?? null
        if (action !== 'sell' && typeof a[3] === 'number') {
          cost = a[3]
          itemizedPurchases += cost
          followingSpend()
        } else if (action !== 'sell') {
          cost = followingSpend()
        }
        if (r && action === 'buy' && isJoker(r.card)) jokers.push(r)
        if (r && action === 'voucher') vouchers.push(r.card)
        if (r && action === 'sell' && area === AREA_JOKERS) {
          jokers = jokers.filter((j) => j.id !== r.id)
        }
      } else if (action === 'use' || action === 'pack_pick') {
        const r = resolve(a[2])
        card = r?.card ?? null
        if (
          action === 'use' &&
          card?.type === 'other_card' &&
          card.kind === 'Booster'
        ) {
          // A pack bought and opened in one step is logged as `use`.
          action = 'open_pack'
          cost = followingSpend()
        }
        targets = resolveAll(a[3], resolve).map((x) => x.card)
        if (r && action === 'pack_pick' && isJoker(r.card)) jokers.push(r)
      } else if (action === 'pack_skip') {
        resolveAll(a[0], resolve)
      } else if (action === 'reroll') {
        rerolls++
        cost = followingSpend()
      }

      if (current.kind === 'shop') {
        current.shopSpent += cost ?? 0
        if (action === 'reroll') current.shopRerolls++
      }
      push({ type: 'shop', t, action, card, targets, cost })
    }
  }

  // Rolls that never reached a shop (the run ended first) stay with the
  // blind they were logged in.
  current.events.push(...heldIdols)
  rounds[0]?.events.push(...carriedIdols)

  // Each roll applies to the next blind actually played after it.
  rounds.forEach((round, at) => {
    const target =
      round.kind === 'blind'
        ? round
        : rounds
            .slice(at + 1)
            .find((r) => r.kind === 'blind' && r.entry === 'selected')
    for (const event of round.events) {
      if (event.type === 'idol') event.appliesTo = target?.label ?? null
    }
  })

  // Money per round, from every recorded balance change.
  const moneyByRound = tallyMoney(events, rounds)
  for (const round of rounds) {
    const m = moneyByRound.get(round.index)
    if (m) {
      round.moneyGained = m.gained
      round.moneySpent = m.spent
    }
  }

  return {
    playerId: log.playerId,
    seed,
    deck,
    stake,
    result,
    rounds: rounds
      .filter((r) => r.entry !== 'setup' || r.events.length > 0)
      .map(({ lastScore: _ignored, ...round }) => round),
    finalJokers: jokers.map((j) => j.card),
    finalDeck,
    vouchers,
    livesLost,
    rerolls,
    itemizedPurchases,
    reconstructed: sawBlind,
  }
}

// money_delta totals attributed to the round whose time span contains them.
function tallyMoney(
  events: DecodedPlayerLog['events'],
  rounds: readonly RoundDraft[]
): Map<number, { gained: number; spent: number }> {
  const out = new Map<number, { gained: number; spent: number }>()
  let r = 0
  for (const [t, opcode, args] of events) {
    while (r + 1 < rounds.length && (rounds[r + 1]?.startT ?? Infinity) <= t) {
      r++
    }
    if (opcode !== 'money_delta') continue
    const v = Array.isArray(args) ? args[0] : args
    if (typeof v !== 'number') continue
    const round = rounds[r]
    if (!round) continue
    const slot = out.get(round.index) ?? { gained: 0, spent: 0 }
    if (v < 0) slot.spent += -v
    else slot.gained += v
    out.set(round.index, slot)
  }
  return out
}

export function buildGameLog(playerLogs: readonly DecodedPlayerLog[]): GameLog {
  const players = playerLogs.map(buildPlayerGameLog)
  const match = findMatchInfo(buildTimeline(playerLogs))

  const pvp: PvpRoundResult[] = []
  const maxRounds = Math.max(0, ...players.map((p) => p.rounds.length))
  for (let index = 1; index <= maxRounds; index++) {
    const entries = players
      .map((p) => ({
        playerId: p.playerId,
        round: p.rounds.find((r) => r.index === index),
      }))
      .filter(
        (e): e is { playerId: string; round: RoundLog } =>
          !!e.round && e.round.isPvp && e.round.finalScore !== null
      )
    if (entries.length < 2) continue
    const scores: Record<string, string> = {}
    for (const e of entries) scores[e.playerId] = e.round.finalScore as string
    const sorted = [...entries].sort((x, y) =>
      compareScoreText(
        y.round.finalScore as string,
        x.round.finalScore as string
      )
    )
    const [top, second] = sorted as [
      (typeof sorted)[number],
      (typeof sorted)[number],
    ]
    const tie =
      compareScoreText(
        top.round.finalScore as string,
        second.round.finalScore as string
      ) === 0
    pvp.push({
      roundIndex: index,
      label: top.round.label,
      scores,
      winnerId: tie ? null : top.playerId,
    })
  }

  return { match, players, pvp }
}
