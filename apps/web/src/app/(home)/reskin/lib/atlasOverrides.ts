// Vanilla atlas positions the catalog build couldn't parse. Seals live in
// Enhancers.png but aren't emitted with atlas coordinates, so hardcode them
// (col,row within the 71×95 grid) rather than regenerating the whole catalog.

import type { CatalogCategory, CatalogObject } from './types'

const SEAL_POS: Record<string, { x: number; y: number }> = {
  Gold: { x: 2, y: 0 },
  Red: { x: 5, y: 4 },
  Blue: { x: 6, y: 4 },
  Purple: { x: 4, y: 4 },
}

/** The 1x atlas file a category's vanilla art lives in, incl. code overrides. */
export function atlasFileFor(cat: CatalogCategory): string | undefined {
  if (cat.id === 'Seal') return 'Enhancers.png'
  return cat.atlasFile
}

/** An object's atlas cell position, incl. code overrides for categories the
 *  catalog ships without positions. */
export function posFor(
  categoryId: string,
  o: CatalogObject
): { x: number; y: number } | undefined {
  if (categoryId === 'Seal') return SEAL_POS[o.key]
  return o.pos
}
