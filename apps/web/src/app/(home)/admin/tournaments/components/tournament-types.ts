export type TournamentStatus =
  | 'draft'
  | 'registration'
  | 'check_in'
  | 'running'
  | 'finished'
  | 'cancelled'

export type ListFilter = 'active' | 'over' | 'all'

export interface AdminTournament {
  id: string
  name: string
  format: string
  status: TournamentStatus
  visibility: 'public' | 'private'
  organiserId: string
  organiserName: string
  players: number
  maxPlayers: number
  waitlist: number
  startsAt: number
  official: boolean
  requireRanked: boolean
  finishedAt: number | null
}

export interface TournamentsResponse {
  tournaments: AdminTournament[]
  total: number
  page: number
  limit: number
}

export interface TournamentPerson {
  id: string
  name: string
}

export interface AdminTournamentDetail {
  id: string
  name: string
  description: string
  notice: string
  status: TournamentStatus
  visibility: 'public' | 'private'
  official: boolean
  requireRanked: boolean
  inviteCode: string
  format: string
  maxPlayers: number
  gameMode: string
  ruleset: string
  organiser: TournamentPerson
  coOrganisers: TournamentPerson[]
  entrants: (TournamentPerson & { checkedIn: boolean; dropped: boolean })[]
  waitlist: TournamentPerson[]
  createdAt: number
  startsAt: number
  startedAt: number | null
  finishedAt: number | null
  closed: { reason: string; message: string | null; at: number } | null
}

export const STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: 'draft',
  registration: 'registration',
  check_in: 'check-in',
  running: 'running',
  finished: 'finished',
  cancelled: 'cancelled',
}

export const FORMAT_LABEL: Record<string, string> = {
  single_elim: 'Single elimination',
  double_elim: 'Double elimination',
  round_robin: 'Round robin',
  swiss: 'Swiss',
}

// Why a tournament was cancelled, from its 'cancelled' event.
export const CLOSE_REASON_LABEL: Record<string, string> = {
  moderator: 'Closed by a moderator',
  organiser: 'Cancelled by the organiser',
  not_enough_players: 'Not enough players to start',
  start_failed: 'Failed to start',
}

export function isOver(status: TournamentStatus): boolean {
  return status === 'finished' || status === 'cancelled'
}

export function formatTime(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString()
}
