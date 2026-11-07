// The strike ladders as the server sends them (apps/server features/strikes).

export const LADDERS = ['chat', 'play'] as const
export type Ladder = (typeof LADDERS)[number]

export const LADDER_LABELS: Record<Ladder, string> = {
  chat: 'Chat ladder',
  play: 'Play ladder',
}

export type LadderStep = 'warning' | '24h' | '7d' | '30d' | 'permanent'
export const LADDER_STEPS: readonly LadderStep[] = [
  'warning',
  '24h',
  '7d',
  '30d',
  'permanent',
]

export const STEP_LABELS: Record<LadderStep | 'custom', string> = {
  warning: 'Warning',
  '24h': '24 hour ban',
  '7d': '7 day ban',
  '30d': '30 day ban',
  permanent: 'Permanent ban',
  custom: 'Custom length',
}

export interface CountingStrike {
  id: string
  appliedStep: LadderStep | 'custom'
  recommendedStep: LadderStep
  deviationReason: string | null
  issuedAt: string
  stopsCountingAt: string
}

export interface LadderSummary {
  steps: LadderStep[]
  recommended: LadderStep
  counting: CountingStrike[]
}

export type StrikeSummary = Record<Ladder, LadderSummary>

// The ladder a punishment counts on unless staff pick another.
export const defaultLadderOf = (kind: 'chat' | 'queue' | 'warning'): Ladder =>
  kind === 'chat' ? 'chat' : 'play'
