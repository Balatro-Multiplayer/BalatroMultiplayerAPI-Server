// Per-object card-edge options and the runtime lift of borders/shapes.
//
// A border is never shipped as art: a shipped 1-bit opaque-pixel MAP is applied
// to a vanilla cell (the object's own, or a fixed source Joker for the coloured
// text) to lift the real border, which is then composited onto the user's art.
// A shape is the object's own vanilla silhouette. Both need the user's exe (the
// vanilla cells); without it only a procedural rounded-corner 'shape' is offered.

import {
  BLACKHOLE_BORDER,
  JOKER_OUTLINE,
  JOKER_TEXT,
  PLANET_OUTLINE,
  PLANET_TEXT,
  SPECTRAL_BORDER,
  TAG_BORDER,
  TAROT_BORDER,
  VOUCHER_BORDER,
} from '../data/border-masks'
import { applyMask, filledSilhouette, roundedCornerMask } from './image'
import type { EdgeMode } from './types'

export interface EdgeOption {
  value: EdgeMode
  label: string
  map?: string // base64 opaque-pixel map (border edges only)
  // Which vanilla cell to lift the border from; undefined = the object's own.
  sourceKey?: string
  source?: string // resolved vanilla cell data URL (filled in by the caller)
}

const SHAPE: EdgeOption = { value: 'shape', label: 'Shape' }

/** The edge options a given object type exposes, before the source cells are
 *  resolved. 'shape' is always offered; border edges carry their map + source. */
export function edgeOptionsFor(
  categoryId: string,
  objectKey: string
): EdgeOption[] {
  switch (categoryId) {
    case 'Joker':
      return [
        SHAPE,
        { value: 'outline', label: 'Outline', map: JOKER_OUTLINE },
        {
          value: 'text-white',
          label: 'Text (White)',
          map: JOKER_TEXT,
          sourceKey: 'j_greedy_joker',
        },
        {
          value: 'text-black',
          label: 'Text (Black)',
          map: JOKER_TEXT,
          sourceKey: 'j_joker',
        },
      ]
    case 'Planet':
      return [
        SHAPE,
        { value: 'outline', label: 'Outline', map: PLANET_OUTLINE },
        { value: 'text', label: 'Text', map: PLANET_TEXT },
      ]
    case 'Tarot':
      return [SHAPE, { value: 'border', label: 'Border', map: TAROT_BORDER }]
    case 'Spectral':
      return [
        SHAPE,
        {
          value: 'border',
          label: 'Border',
          // Black Hole has its own frame; the Soul borrows the tarot frame.
          map:
            objectKey === 'c_black_hole'
              ? BLACKHOLE_BORDER
              : objectKey === 'c_soul'
                ? TAROT_BORDER
                : SPECTRAL_BORDER,
        },
      ]
    case 'Voucher':
      return [SHAPE, { value: 'border', label: 'Border', map: VOUCHER_BORDER }]
    case 'Tag':
      return [SHAPE, { value: 'border', label: 'Border', map: TAG_BORDER }]
    default:
      // Other P_CENTERS (enhancers, decks, boosters…): shape only.
      return [SHAPE]
  }
}

/** Compute the edge assets renderSprite needs for the chosen option: the
 *  `interior` silhouette (the object's real filled outline, or a procedural
 *  rounded card with no exe) and, for border edges, the lifted `ring`. */
export async function buildEdge(
  option: EdgeOption | undefined,
  vanillaCell: string | undefined,
  target: { w: number; h: number }
): Promise<{ interior?: string; ring?: string }> {
  if (!option) return {}
  const interior = vanillaCell
    ? await filledSilhouette(vanillaCell, { threshold: 128 })
    : roundedCornerMask(
        target.w,
        target.h,
        Math.round(Math.min(target.w, target.h) * 0.12)
      )
  if (option.value === 'shape') return { interior }
  if (option.map && option.source) {
    const ring = await applyMask(
      option.source,
      `data:image/png;base64,${option.map}`
    )
    return { interior, ring }
  }
  return { interior }
}
