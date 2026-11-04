import type { PlayingCardSkin, ProjectState } from './types'

export function skinName(skin: PlayingCardSkin, modName: string): string {
  return skin.name.trim() || modName || 'CustomReskin'
}

/** Import old single-sheet projects without losing their image or name. Also
 * used at export/update boundaries for an editor kept open across an update. */
export function migrateDeckSkins(project: ProjectState): ProjectState {
  if (project.deckSkins !== undefined && !Array.isArray(project.deckSkins)) {
    throw new Error('The imported card skins must be a list.')
  }
  const deckSkins = [...(project.deckSkins ?? [])]
  const legacy = project.sheets.playing_cards?.[0]
  if (legacy) {
    let id = 'legacy'
    while (deckSkins.some((skin) => skin.id === id)) id += '_old'
    deckSkins.push({
      id,
      name: project.options.displayName || 'CustomReskin',
      low: legacy,
    })
  }
  const sheets = { ...project.sheets }
  delete sheets.playing_cards
  return { ...project, schema: 4, sheets, deckSkins }
}

export function newDeckSkin(modName: string, index: number): PlayingCardSkin {
  // getRandomValues works on the tailnet HTTP demo too; randomUUID requires HTTPS.
  const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16).padStart(8, '0')
  ).join('')
  return {
    id,
    name: `${modName || 'CustomReskin'}${index ? ` ${index + 1}` : ''}`,
  }
}

/** Reject imported IDs that could collide or escape generated atlas paths. */
export function validateDeckSkins(skins: PlayingCardSkin[]): void {
  const ids = new Set<string>()
  for (const skin of skins) {
    if (
      !skin ||
      typeof skin.id !== 'string' ||
      !/^[a-z0-9_-]{1,80}$/.test(skin.id) ||
      ids.has(skin.id)
    ) {
      throw new Error(
        'Card skins need unique, valid IDs. Remove and recreate the affected skin.'
      )
    }
    if (
      typeof skin.name !== 'string' ||
      (skin.low !== undefined && typeof skin.low !== 'string') ||
      (skin.high !== undefined && typeof skin.high !== 'string')
    ) {
      throw new Error(
        'Invalid card skin name or image in the imported project.'
      )
    }
    ids.add(skin.id)
  }
}

export function deckSkinSpriteCount(skins: PlayingCardSkin[]): number {
  return skins.reduce(
    (count, skin) =>
      count + Number(Boolean(skin.low)) + Number(Boolean(skin.high)),
    0
  )
}
