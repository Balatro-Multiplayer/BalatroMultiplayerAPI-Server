import type { Privilege } from '@bmp/types'

export interface Player {
  id: string
  displayName: string
  steamName: string
  useDiscordName: boolean
  preferredJoker: string | null
  discordLinked: boolean
  discordUsername: string | null
  privileges: Privilege[]
}
