// Number-line geometry for the Idol roll track, ported from the old log
// parser (www lib/idol-hit-geometry.ts).
export type IdolHitEntry = { rank: string; suit: string; count: number }

export type IdolHit = {
  roll: number | null
  winner: { rank: string; suit: string }
  cards: IdolHitEntry[]
}

const SUIT_GLYPH: Record<string, string> = {
  S: '♠',
  H: '♥',
  C: '♣',
  D: '♦',
}

export const NARROW_SEGMENT_THRESHOLD = 0.16

/** Entries kept on each side of the winner in the windowed view. */
export const WINDOW_RADIUS = 3
/** Minimum horizontal gap (in % of track width) required between two rendered boundary labels
 * when the track's actual rendered width isn't known (collapsed/windowed tracks). */
export const LABEL_MIN_GAP_PCT = 4
/** Minimum horizontal gap (in px) required between two rendered boundary labels when the
 * track's actual rendered width IS known (expanded track) — tuned for an ~11px mono label. */
export const LABEL_MIN_GAP_PX = 30

export function suitGlyph(suit: string): string {
  return SUIT_GLYPH[suit] ?? suit.slice(0, 1)
}

export function isWinningEntry(
  entry: IdolHitEntry,
  winner: IdolHit['winner']
): boolean {
  return entry.rank === winner.rank && entry.suit === winner.suit
}

export type IdolHitBoundary = {
  /** Absolute cumulative fraction over the *full* card list — always used for the label text. */
  frac: number
  /** Position (0-100) within the currently rendered range — used for layout. */
  position: number
  isWinnerEdge: boolean
}

/** Cumulative fraction of the full card list's total count at each entry boundary (length cards.length + 1). */
export function computeHitCumulativeFracs(cards: IdolHitEntry[]): number[] {
  const total = cards.reduce((sum, entry) => sum + entry.count, 0)
  if (total === 0) {
    return new Array(cards.length + 1).fill(0)
  }

  let cumulative = 0
  return [
    0,
    ...cards.map((entry) => {
      cumulative += entry.count
      return cumulative / total
    }),
  ]
}

export type IdolHitBoundaryRange = {
  start: number
  end: number
  lo: number
  hi: number
}

/**
 * Boundaries (entry edges) of a card list, optionally restricted to a sub-range of entry
 * indices and rescaled to that range's own 0-100 layout (used by the windowed view). With no
 * range, this covers the whole list and `position === frac * 100`.
 */
export function computeHitBoundaries(
  cards: IdolHitEntry[],
  winner: IdolHit['winner'],
  range?: IdolHitBoundaryRange
): IdolHitBoundary[] {
  const total = cards.reduce((sum, entry) => sum + entry.count, 0)
  if (total === 0) {
    return []
  }

  const winnerIndex = cards.findIndex((entry) => isWinningEntry(entry, winner))
  const fracs = computeHitCumulativeFracs(cards)

  const start = range?.start ?? 0
  const end = range?.end ?? cards.length
  const lo = range?.lo ?? 0
  const hi = range?.hi ?? 1
  const span = hi - lo || 1

  const boundaries: IdolHitBoundary[] = []
  for (let boundaryIndex = start; boundaryIndex <= end; boundaryIndex++) {
    const frac = fracs[boundaryIndex] ?? 0
    boundaries.push({
      frac,
      position: ((frac - lo) / span) * 100,
      isWinnerEdge:
        winnerIndex >= 0 &&
        (boundaryIndex === winnerIndex || boundaryIndex === winnerIndex + 1),
    })
  }
  return boundaries
}

export type IdolHitWindow = {
  windowEntries: IdolHitEntry[]
  windowTotal: number
  beforeCount: number
  afterCount: number
  windowLo: number
  windowHi: number
  sliceStart: number
  sliceEnd: number
}

/** Slices a large card list down to WINDOW_RADIUS entries on each side of the winner. */
export function computeIdolHitWindow(
  cards: IdolHitEntry[],
  winner: IdolHit['winner']
): IdolHitWindow {
  const winnerIndex = cards.findIndex((entry) => isWinningEntry(entry, winner))
  const centerIndex =
    winnerIndex >= 0 ? winnerIndex : Math.floor(cards.length / 2)
  const sliceStart = Math.max(0, centerIndex - WINDOW_RADIUS)
  const sliceEnd = Math.min(cards.length, centerIndex + WINDOW_RADIUS + 1)
  const fracs = computeHitCumulativeFracs(cards)
  const windowEntries = cards.slice(sliceStart, sliceEnd)

  return {
    windowEntries,
    windowTotal: windowEntries.reduce((sum, entry) => sum + entry.count, 0),
    beforeCount: sliceStart,
    afterCount: cards.length - sliceEnd,
    windowLo: fracs[sliceStart] ?? 0,
    windowHi: fracs[sliceEnd] ?? 1,
    sliceStart,
    sliceEnd,
  }
}

export type LabelPlacement = {
  /** Boundary indices whose numeric label is rendered. */
  shown: Set<number>
  /** Shown-label indices that must be offset onto a second line because they'd otherwise
   * overlap the previous always-shown label (e.g. two winner edges one segment apart). */
  staggered: Set<number>
}

/**
 * Picks which boundaries get a visible numeric label. The two ends of the visible range and
 * both winner-slice edges are ALWAYS shown; when one of them would land within the minimum
 * gap of the previously shown always-visible label, it's staggered onto a second line instead
 * of being dropped — so a narrow winner slice never loses one of its two edges. Every other
 * boundary is an optional candidate (only shown once a wide-enough segment has passed) and is
 * simply skipped, never staggered, when it would collide with the previously shown label.
 *
 * The gap is measured in **pixels** when `trackWidthPx` is known (the expanded track, whose
 * rendered width is `cards.length * EXPANDED_SEGMENT_PX`) so the collision distance reflects
 * the track's actual size rather than a fixed percentage — this is what lets the wide expanded
 * view surface far more labels than the narrow collapsed/windowed views, which fall back to a
 * percentage-of-track-width gap (`LABEL_MIN_GAP_PCT`) since their rendered width isn't tracked.
 */
export function computeLabelPlacement(
  boundaries: IdolHitBoundary[],
  trackWidthPx?: number
): LabelPlacement {
  const shown = new Set<number>()
  const staggered = new Set<number>()
  const lastIndex = boundaries.length - 1
  if (lastIndex < 0) {
    return { shown, staggered }
  }

  const gap = (a: number, b: number): number =>
    trackWidthPx != null
      ? (Math.abs(a - b) / 100) * trackWidthPx
      : Math.abs(a - b)
  const minGap = trackWidthPx != null ? LABEL_MIN_GAP_PX : LABEL_MIN_GAP_PCT

  let lastShownPosition: number | null = null

  for (let index = 0; index <= lastIndex; index++) {
    const boundary = boundaries[index]
    if (!boundary) {
      continue
    }

    const isEndBoundary = index === 0 || index === lastIndex
    const isAlwaysShow = isEndBoundary || boundary.isWinnerEdge

    if (isAlwaysShow) {
      shown.add(index)
      if (
        lastShownPosition !== null &&
        gap(boundary.position, lastShownPosition) < minGap
      ) {
        staggered.add(index)
      }
      lastShownPosition = boundary.position
      continue
    }

    // A boundary is a label candidate when the segment left of it is wide
    // enough to read a number against. With a known pixel width (the expanded
    // scroll view) measure that in px, so a 1/52 slice — only ~1.9% of the
    // track but a comfortable 46px — still gets labelled.
    const previousBoundary = boundaries[index - 1]
    if (previousBoundary == null) {
      continue
    }

    const segmentSpan = boundary.position - previousBoundary.position
    const wideSegment =
      trackWidthPx != null
        ? (segmentSpan / 100) * trackWidthPx >= LABEL_MIN_GAP_PX
        : segmentSpan >= NARROW_SEGMENT_THRESHOLD * 100
    if (!wideSegment) {
      continue
    }

    const gapOk =
      lastShownPosition === null ||
      gap(boundary.position, lastShownPosition) >= minGap
    if (gapOk) {
      shown.add(index)
      lastShownPosition = boundary.position
    }
  }

  return { shown, staggered }
}
