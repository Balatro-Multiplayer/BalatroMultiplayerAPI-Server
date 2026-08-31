import type { CardRegistry } from '../lib/card-ref'
import { isRawRef, resolveCardRef } from '../lib/card-ref'
import { ArgsView } from './args-view'
import { CardChip } from './card-chip'

function chipsFor(refs: unknown[], registry: CardRegistry) {
  return refs
    .filter(isRawRef)
    .map((ref, i) => {
      const card = resolveCardRef(ref, registry)
      return card ? <CardChip key={i} card={card} /> : null
    })
    .filter(Boolean)
}

export function EventDetail({
  opcode,
  args,
  registry,
}: {
  opcode: string
  args: unknown
  registry: CardRegistry | undefined
}) {
  if (!registry || !Array.isArray(args)) {
    return <ArgsView args={args} />
  }

  switch (opcode) {
    case 'play':
    case 'discard': {
      const refs = Array.isArray(args[1]) ? (args[1] as unknown[]) : []
      if (refs.length === 0) return <ArgsView args={args} />
      return <span className='flex flex-wrap gap-2'>{chipsFor(refs, registry)}</span>
    }

    case 'sell':
    case 'buy':
    case 'open_pack':
    case 'voucher': {
      const ref = args[2]
      if (!isRawRef(ref)) return <ArgsView args={args} />
      const card = resolveCardRef(ref, registry)
      return card ? <CardChip card={card} /> : <ArgsView args={args} />
    }

    case 'use':
    case 'pack_pick': {
      const ref = args[2]
      const targets = Array.isArray(args[3]) ? (args[3] as unknown[]) : []
      if (!isRawRef(ref)) return <ArgsView args={args} />
      const card = resolveCardRef(ref, registry)
      if (!card) return <ArgsView args={args} />
      return (
        <span className='flex flex-wrap items-center gap-2'>
          <CardChip card={card} />
          {targets.length > 0 && (
            <>
              <span className='text-muted-foreground text-xs'>on</span>
              {chipsFor(targets, registry)}
            </>
          )}
        </span>
      )
    }

    case 'pack_skip': {
      const refs = Array.isArray(args[0]) ? (args[0] as unknown[]) : []
      if (refs.length === 0) return <ArgsView args={args} />
      return <span className='flex flex-wrap gap-2'>{chipsFor(refs, registry)}</span>
    }

    default:
      return <ArgsView args={args} />
  }
}
