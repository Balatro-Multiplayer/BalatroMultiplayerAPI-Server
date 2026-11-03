import type { ResolvedCard } from '../card-ref'

// Source-agnostic model behind the readable log view. Both the server replay
// log adapter (build-game-log.ts) and the raw Lovely-log adapter produce it,
// so one set of components renders either.

export interface IdolRollCard {
  rank: string
  suit: string
  count: number
}

export interface IdolRoll {
  t: number
  /** 0..1, or null when the log did not carry it. */
  roll: number | null
  winner: string
  cards: IdolRollCard[]
}

export type ShopAction =
  | 'buy'
  | 'open_pack'
  | 'voucher'
  | 'sell'
  | 'reroll'
  | 'use'
  | 'pack_pick'
  | 'pack_skip'

export type GameEvent =
  | {
      type: 'hand'
      t: number
      kind: 'play' | 'discard'
      cards: ResolvedCard[]
      /** Hand positions played/discarded; the only card info some logs keep. */
      positions: number[]
      /** The blind's running total after this action (score text). */
      roundScore: string | null
      /** What this hand added to the running total (score text). */
      handScore: string | null
      handsLeft: number | null
      jokers: ResolvedCard[]
    }
  | {
      type: 'shop'
      t: number
      action: ShopAction
      card: ResolvedCard | null
      targets: ResolvedCard[]
      cost: number | null
    }
  | { type: 'money'; t: number; delta: number }
  | { type: 'leave_shop'; t: number }
  | { type: 'cashout'; t: number; dollars: number | null }
  | { type: 'life_lost'; t: number; lost: number; lives: number | null }
  | { type: 'ready'; t: number; ready: boolean }
  | ({
      type: 'idol'
      /** Label of the blind this roll applies to, when the log reaches it. */
      appliesTo: string | null
      /** Jokers owned when the roll was made. */
      jokers: ResolvedCard[]
    } & IdolRoll)
  | { type: 'other'; t: number; opcode: string; args: unknown }

export interface RoundLog {
  /** A blind, or the shop that follows it (cash out -> leave shop). */
  kind: 'blind' | 'shop'
  /**
   * Alignment key across players: blinds are whole numbers in the order they
   * were entered, a shop is its blind's index + 0.5 (so a player who skipped
   * a blind, and so has no shop after it, still lines up with the other).
   */
  index: number
  /** 1-based ante, counted from blind order (3 blinds per ante). */
  ante: number
  /** 0 = small, 1 = big, 2 = boss / PvP slot. */
  slot: 0 | 1 | 2
  label: string
  /** How the blind was entered; 'setup' is anything before the first blind. */
  entry: 'selected' | 'skipped' | 'setup'
  /** The blind's key (e.g. bl_small, bl_mp_nemesis) when the log names it. */
  blindKey: string | null
  /** The PvP blind: by key when known, else the boss slot. */
  isPvp: boolean
  anteKey: string | null
  startT: number
  endT: number
  events: GameEvent[]
  /** Final running total for the blind (score text), if any hand was scored. */
  finalScore: string | null
  handsPlayed: number
  discards: number
  moneyGained: number
  moneySpent: number
  /** Shops only: dollars spent on purchases and rerolls, and reroll count. */
  shopSpent: number
  shopRerolls: number
}

export interface PlayerGameLog {
  playerId: string
  seed: string | null
  deck: string | null
  stake: number | null
  result: string | null
  rounds: RoundLog[]
  finalJokers: ResolvedCard[]
  /** The whole deck at the end of the run, when the log recorded it. */
  finalDeck: ResolvedCard[]
  vouchers: ResolvedCard[]
  livesLost: number
  rerolls: number
  itemizedPurchases: number
  /** True when jokers/blinds were rebuilt rather than read from the log. */
  reconstructed: boolean
}

export interface PvpRoundResult {
  roundIndex: number
  label: string
  /** playerId -> final running total (score text) */
  scores: Record<string, string>
  winnerId: string | null
}

export interface GameLog {
  match: Record<string, unknown> | null
  players: PlayerGameLog[]
  pvp: PvpRoundResult[]
}
