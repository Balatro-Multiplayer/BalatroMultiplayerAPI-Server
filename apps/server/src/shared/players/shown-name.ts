// The name a player shows as on the website and in staff tools. Their own pick
// (Discord name if chosen, else Steam name) unless a username ban is in force:
// then everyone sees the Ban name, which comes from the same id the game uses
// (the Nakama user id; a player who never played on Nakama has none, so their
// own id stands in). Staff see the Ban name with the real name next to it.
import { banNameOf } from '@bmp/types'

export interface NameFacts {
	id: string
	nakamaUserId: string | null
	steamName: string
	discordUsername: string | null
	useDiscordName: boolean
}

export function ownNameOf(facts: Pick<NameFacts, 'steamName' | 'discordUsername' | 'useDiscordName'>): string {
	return facts.useDiscordName && facts.discordUsername ? facts.discordUsername : facts.steamName
}

export function banNameFor(facts: Pick<NameFacts, 'id' | 'nakamaUserId'>): string {
	return banNameOf(facts.nakamaUserId ?? facts.id)
}

// What every player sees.
export function shownNameOf(facts: NameFacts, usernameBanned: boolean): string {
	return usernameBanned ? banNameFor(facts) : ownNameOf(facts)
}

// What staff see: the Steam name, or the Ban name with the real name next to it.
export function staffNameOf(facts: NameFacts, usernameBanned: boolean): string {
	return usernameBanned ? `${banNameFor(facts)} (${facts.steamName})` : facts.steamName
}
