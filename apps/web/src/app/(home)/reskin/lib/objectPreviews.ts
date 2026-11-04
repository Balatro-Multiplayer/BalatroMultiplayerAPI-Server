import { atlasFileFor, posFor } from './atlasOverrides'
import { getAtlasCells } from './exeAssets'
import type { GameArchive } from './gameArchive'
import type { Rect } from './image'
import type { Catalog, CatalogCategory } from './types'

export interface ObjectPreviews {
  base: Record<string, string>
  soul: Record<string, string>
}

export function objectPreviewPlan(catalog: Catalog, category: CatalogCategory) {
  const atlases = new Map<string, Array<{ id: string; rect: Rect }>>()
  const add = (
    file: string | undefined,
    id: string,
    pos: { x: number; y: number } | undefined
  ) => {
    if (!file || !pos) return
    const cells = atlases.get(file) ?? []
    cells.push({
      id,
      rect: {
        x: pos.x * category.px,
        y: pos.y * category.py,
        w: category.px,
        h: category.py,
      },
    })
    atlases.set(file, cells)
  }
  for (const object of catalog.spriteObjects[category.id] ?? []) {
    add(
      atlasFileFor(category),
      `base:${object.key}`,
      posFor(category.id, object)
    )
    add(
      object.soulAtlasFile ?? atlasFileFor(category),
      `soul:${object.key}`,
      object.soulPos
    )
  }
  return atlases
}

const cache = new WeakMap<
  GameArchive,
  Map<CatalogCategory, Promise<ObjectPreviews>>
>()

/** Cache both layers together, by archive and stable catalog category identity.
 * Opening a modal before tiles finish uses the same in-flight extraction. */
export function loadObjectPreviews(
  archive: GameArchive,
  catalog: Catalog,
  category: CatalogCategory
): Promise<ObjectPreviews> {
  let categories = cache.get(archive)
  if (!categories) {
    categories = new Map()
    cache.set(archive, categories)
  }
  const existing = categories.get(category)
  if (existing) return existing
  const pending = (async () => {
    const result: ObjectPreviews = { base: {}, soul: {} }
    await Promise.all(
      Array.from(
        objectPreviewPlan(catalog, category),
        async ([file, cells]) => {
          const images = await getAtlasCells(
            archive,
            `resources/textures/1x/${file}`,
            cells
          )
          for (const [id, image] of Object.entries(images)) {
            const [layer, key] = id.split(':')
            if (key) (layer === 'base' ? result.base : result.soul)[key] = image
          }
        }
      )
    )
    return result
  })()
  categories.set(category, pending)
  void pending.catch(() => categories.delete(category))
  return pending
}
