import type { DecodedPlayerLog } from './decode-player-logs'

// Two independently-sourced totals per player, computed from opcodes that
// only exist once cost-carrying buy/open_pack/voucher args and the
// money_delta opcode landed (see overrides/game.lua's ease_dollars hook /
// objects/replay_log/record.lua's SPDRN equivalent) -- older recordings
// predate both and simply won't have the data to compute either number.
//
// This is NOT the same comparison www's log parser makes ("Reported" vs
// "Actual" spending): that system has a client self-report event
// (spentLastShop) this protocol has no equivalent of. Here:
//   - itemizedPurchases: sum of each buy/open_pack/voucher event's own
//     `cost` (the 4th positional arg) -- a bottom-up account of individual
//     shop purchases specifically.
//   - observedSpend / observedGain: sum of negative/positive money_delta
//     deltas -- a top-down account of every balance change for ANY reason
//     (blind rewards, interest, joker triggers, sells, rerolls, purchases,
//     ...), not just shop purchases. observedSpend will usually exceed
//     itemizedPurchases (rerolls/interest-adjacent effects aren't
//     "purchases"), so a mismatch there isn't inherently suspicious --
//     unlike a true reported-vs-actual reconciliation, this doesn't reduce
//     to a single pass/fail signal, just two honestly-labeled numbers.
export interface PlayerSpending {
  playerId: string
  itemizedPurchases: number
  observedSpend: number
  observedGain: number
  hasData: boolean
}

const BUY_OPCODES = new Set(['buy', 'open_pack', 'voucher'])

export function computePlayerSpending(
  playerLogs: readonly DecodedPlayerLog[]
): PlayerSpending[] {
  return playerLogs.map(({ playerId, events }) => {
    let itemizedPurchases = 0
    let observedSpend = 0
    let observedGain = 0
    let hasData = false

    for (const [, opcode, args] of events) {
      if (BUY_OPCODES.has(opcode) && Array.isArray(args)) {
        const cost = args[3]
        if (typeof cost === 'number') {
          itemizedPurchases += cost
          hasData = true
        }
      } else if (opcode === 'money_delta' && Array.isArray(args)) {
        const delta = args[0]
        if (typeof delta === 'number') {
          if (delta < 0) observedSpend += -delta
          else observedGain += delta
          hasData = true
        }
      }
    }

    return { playerId, itemizedPurchases, observedSpend, observedGain, hasData }
  })
}
