import { type JokerInfo, jokers } from '@/shared/jokers'

// Multiplayer-mod jokers (names from the mod's en-us localization, art from
// public/cards). The shared joker table only covers the vanilla jokers plus
// three MP ones, so everything else the mod adds is listed here.
const MP_JOKERS: Record<string, JokerInfo> = {
  j_mp_bloodstone: { name: 'Bloodstone', file: 'j_mp_bloodstone.png' },
  j_mp_conjoined_joker: {
    name: 'Conjoined Joker',
    file: 'j_mp_conjoined_joker.png',
  },
  j_mp_defensive_joker: {
    name: 'Defensive Joker',
    file: 'j_mp_defensive_joker.png',
  },
  j_mp_hanging_chad: { name: 'Hanging Chad', file: 'j_mp_hanging_chad.png' },
  j_mp_lets_go_gambling: {
    name: "Let's Go Gambling",
    file: 'j_mp_lets_go_gambling.png',
  },
  j_mp_magnet: { name: 'Magnet', file: 'j_mp_magnet.png' },
  j_mp_pacifist: { name: 'Pacifist', file: 'j_mp_pacifist.png' },
  j_mp_penny_pincher: { name: 'Penny Pincher', file: 'j_mp_penny_pincher.png' },
  j_mp_pizza: { name: 'Pizza', file: 'j_mp_pizza.png' },
  j_mp_skip_off: { name: 'Skip-Off', file: 'j_mp_skip_off.png' },
  j_mp_speedrun: { name: 'SPEEDRUN', file: 'j_mp_speedrun.png' },
  j_mp_taxes: { name: 'Taxes', file: 'j_mp_taxes.png' },
  j_todo_list: { name: 'To Do List', file: 'j_todo_list.png' },
}

// Variants of a joker (sandbox rulesets, the experimental ticket, the rare
// Idol) reuse the base joker's art: j_mp_cloud_9_sandbox -> j_cloud_9,
// j_mp_ticket_experimental -> j_mp_ticket, j_mp_idol_rare -> j_idol.
function candidates(ident: string): string[] {
  const base = ident.replace(/_(sandbox|experimental|rare)$/, '')
  return [ident, base, base.replace(/^j_mp_/, 'j_')]
}

export function jokerArt(ident: string): JokerInfo | null {
  for (const key of candidates(ident)) {
    const found = MP_JOKERS[key] ?? jokers[key]
    if (found) return found
  }
  return null
}
