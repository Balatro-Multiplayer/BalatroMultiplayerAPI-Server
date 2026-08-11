import { isRawRef } from './card-ref'

// Where a card ref lives within each opcode's args -- mirrors the exact
// positional shape each record() call site in overrides/game.lua /
// objects/replay_log/record.lua builds. Deliberately opcode-aware rather
// than a generic "scan for anything ref-shaped" walker: a single-index
// array like `[3]` (e.g. one highlighted card's position) is indistinguishable
// from an already-seen ref `[id]` by shape alone -- only knowing which args
// position an opcode actually puts a ref in avoids misreading one as the
// other.
//
// - play / discard: args = [indices[], refs[]]
// - sell / buy / open_pack / voucher: args = [area, idx, ref]
// - use / pack_pick: args = [idx, targets[], ref, target_refs[]]
// - pack_skip: args = [refs[]]
// - reorder: args = [area_id, perm, moved[]] where moved[i] = [ref, old, new]
// - everything else (select_blind, skip_blind, cashout, reroll, ready_blind,
//   set_ante_key, hand_result, manifest/end/chk): no card refs.
export function extractRefs(opcode: string, args: unknown): unknown[][] {
  if (!Array.isArray(args)) return []

  switch (opcode) {
    case 'play':
    case 'discard':
      return Array.isArray(args[1]) ? (args[1] as unknown[][]) : []

    case 'sell':
    case 'buy':
    case 'open_pack':
    case 'voucher':
      return isRawRef(args[2]) ? [args[2]] : []

    case 'use':
    case 'pack_pick': {
      const refs: unknown[][] = []
      if (isRawRef(args[2])) refs.push(args[2])
      if (Array.isArray(args[3])) refs.push(...(args[3] as unknown[][]))
      return refs
    }

    case 'pack_skip':
      return Array.isArray(args[0]) ? (args[0] as unknown[][]) : []

    case 'reorder':
      return Array.isArray(args[2])
        ? (args[2] as unknown[][])
            .map((moved) => moved[0] as unknown[])
            .filter(isRawRef)
        : []

    default:
      return []
  }
}
