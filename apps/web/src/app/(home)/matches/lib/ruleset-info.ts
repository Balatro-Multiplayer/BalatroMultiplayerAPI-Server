import { DECK_INFO } from '@/shared/decks'

// Ported from www's log-parser (src/app/(home)/log-parser/page.tsx) --
// RULESET_INFO has no equivalent anywhere in this app yet (unlike
// DECK_INFO/DECK_IMAGES, already in @/shared/decks from the shared www
// origin). normalizeLookupKey handles both PvP's raw ruleset keys
// (`ruleset_mp_vanilla` -> `vanilla`) and SPDRN's manifest, where the
// `ruleset` field is actually a gamemode key doubling as ruleset (see
// BalatroMultiplayerSpeed's own begin_run wiring) -- unrecognized keys
// (including every SPDRN one) fall back to the raw value rather than a
// wrong label, exactly like www's own getRulesetInfo does for anything it
// doesn't recognize either.

export interface NamedInfo {
  name: string
  description: string
}

const RULESET_INFO: Record<string, NamedInfo> = {
  badlatro: {
    name: 'Badlatro',
    description:
      'Special permanent weekly-style ruleset with broad bans across jokers, consumables, tags, and more.',
  },
  blitz: {
    name: 'Standard',
    description:
      'Balanced Multiplayer ruleset with Multiplayer jokers and balance changes plus full lobby control.',
  },
  legacyranked: {
    name: 'Legacy Ranked',
    description:
      'Minimal competitive ruleset using mostly vanilla content, forced Attrition, and locked settings.',
  },
  majorleague: {
    name: 'Major League',
    description:
      'Official Major League ruleset with vanilla cards, 180 second timer, The Order banned, and Attrition.',
  },
  minorleague: {
    name: 'Minor League',
    description:
      'Official Minor League ruleset with vanilla cards, 210 second timer, The Order required, and Attrition.',
  },
  sandbox: {
    name: 'Sandbox: Extra Credit',
    description:
      'Expanded competitive ruleset with Extra Credit jokers, Spectral changes, comeback reworks, and no score preview.',
  },
  smallworld: {
    name: 'Small World',
    description:
      '75% of jokers, consumables, vouchers, and tags are randomly banned each game. Replacements can duplicate.',
  },
  speedlatro: {
    name: 'Speedlatro',
    description:
      'Fast variant with an extremely short timer between PvP blinds and forced Attrition pacing.',
  },
  standardranked: {
    name: 'Standard Ranked',
    description:
      'Official competitive ruleset: Standard ruleset, forced Attrition, The Order enabled, and locked settings.',
  },
  traditional: {
    name: 'Traditional',
    description:
      'Multiplayer content without time pressure. Timer disabled and time-based jokers banned.',
  },
  vanilla: {
    name: 'Vanilla',
    description:
      'Original Balatro ruleset with no Multiplayer jokers or balance changes.',
  },
  weekly: {
    name: 'Weekly',
    description: 'Special rotating ruleset that changes weekly or bi-weekly.',
  },
}

export function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^ruleset_mp_/, '')
    .replace(/^gamemode_mp_/, '')
    .replace(/^b_mp_/, '')
    .replace(/^b_/, '')
    .replace(/ deck$/i, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function getRulesetInfo(value: unknown): NamedInfo | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return RULESET_INFO[normalizeLookupKey(value)] ?? null
}

// DECK_INFO itself already exists in @/shared/decks (this app shares origin
// with www) -- only the lookup-by-raw-manifest-value wrapper was missing.
// Unlike PvP's ruleset keys, both mods' `deck` field is already a human
// display name ("Red Deck"), not an internal key, so normalizeLookupKey's
// " deck$" strip is what does the real work here.
export function getDeckInfo(value: unknown): NamedInfo | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return DECK_INFO[normalizeLookupKey(value)] ?? null
}
