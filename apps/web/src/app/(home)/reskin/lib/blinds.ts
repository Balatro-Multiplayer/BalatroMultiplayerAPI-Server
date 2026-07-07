// Turn a single uploaded image into a Balatro blind's animation.
//
// A blind is a poker chip that sits still for most of its 21-frame loop, then a
// diagonal shine sweeps across. We clip the user's art to the chip silhouette
// and, optionally, add each vanilla frame's shine (the light it adds over the
// still base frame) so a custom blind animates natively.

import {
  addOverlay,
  applyMask,
  type FitMode,
  filledSilhouette,
  fitInto,
  lightDelta,
} from './image'

export async function composeBlindSingle(
  userImg: string,
  vanillaFrames: string[],
  opts: { targetW: number; targetH: number; fit?: FitMode; overlay: boolean }
): Promise<string[]> {
  const base = vanillaFrames[0]
  if (!base) return []
  const shape = await filledSilhouette(base, { threshold: 128 })
  const fitted = await fitInto(
    userImg,
    opts.targetW,
    opts.targetH,
    opts.fit ?? 'stretch'
  )
  const clipped = await applyMask(fitted, shape)
  if (!opts.overlay) return vanillaFrames.map(() => clipped)
  const out: string[] = []
  for (const f of vanillaFrames) {
    const delta = await lightDelta(f, base)
    out.push(await addOverlay(clipped, delta))
  }
  return out
}

/** Clip already-extracted frames (a sprite-sheet/GIF upload) to the chip shape. */
export async function clipBlindFrames(
  frames: string[],
  vanillaBase: string | undefined
): Promise<string[]> {
  if (!vanillaBase) return frames
  const shape = await filledSilhouette(vanillaBase, { threshold: 128 })
  return Promise.all(frames.map((f) => applyMask(f, shape)))
}
