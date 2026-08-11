// Decodes MPAPI.replay.card_ref's compact wire shape (recorder.lua:271-333):
// already-seen -> [id, tag...] (id > 0); first-seen -> [-id, kind, ident..., tag...]
// (id negative). Registries are per-player: each recording client assigns its
// own sequential ids (RLOG._card_ids/_next_card_id, reset at every begin_run),
// so the same numeric id in two different players' streams refers to two
// unrelated cards -- never share a registry across players.

export type ResolvedCard =
  | { type: 'playing_card'; suit: string; value: string; tags: string[] }
  | { type: 'other_card'; kind: string; ident: string; tags: string[] }

export type CardRegistry = Map<number, ResolvedCard>

type RawRef = unknown[]

export function isRawRef(value: unknown): value is RawRef {
  return (
    Array.isArray(value) && value.length >= 1 && typeof value[0] === 'number'
  )
}

// Resolves one ref, registering it if this is the ref's first appearance.
// Returns null only for a malformed/never-seen already-seen ref (shouldn't
// happen against a well-formed log, but a corrupt/truncated one is possible).
export function resolveCardRef(
  ref: RawRef,
  registry: CardRegistry
): ResolvedCard | null {
  const first = ref[0] as number
  if (first > 0) {
    return registry.get(first) ?? null
  }

  const id = -first
  const kind = ref[1] as string
  const resolved: ResolvedCard =
    kind === 'pc'
      ? {
          type: 'playing_card',
          suit: ref[2] as string,
          value: ref[3] as string,
          tags: ref.slice(4) as string[],
        }
      : {
          type: 'other_card',
          kind,
          ident: ref[2] as string,
          tags: ref.slice(3) as string[],
        }
  registry.set(id, resolved)
  return resolved
}

export function tagValue(tags: string[], prefix: string): string | null {
  const tag = tags.find((t) => t.startsWith(prefix))
  return tag ? tag.slice(prefix.length) : null
}
