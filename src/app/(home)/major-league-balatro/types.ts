import type { players } from './_constants/players'

export type Player = {
  id: string
  name: string
  division: 'Blue' | 'Red'
  picture: string
  socials: {
    twitch?: string
    youtube?: string
  }
}

export type Match = {
  id: number
  division: 'Blue' | 'Red' | 'Playoff' | 'Finals'
  player1Id: keyof typeof players
  player2Id: keyof typeof players
  datetime: Date
  vod1?: string
  vod2?: string
  completed: boolean
  week: number | 'Play-in' | 'Finals'
}
export type WeekStatus =
  | 'completed'
  | 'current'
  | 'upcoming'
  | 'playoff'
  | 'finals'

export type BadgeProps = {
  variant: 'outline'
  className: string
  text: string
}

export type WeekConfig = {
  label: string
  badgeProps?: BadgeProps
}
