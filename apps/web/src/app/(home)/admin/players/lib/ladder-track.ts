// The strike ladder as the side column draws it: every step, the ones used
// by a strike that still counts, and the next step.
import type { Ladder, LadderStep, LadderSummary } from './strikes'

export type StepState = 'hit' | 'next' | 'ahead'

const PREFIX: Record<Ladder, string> = { chat: 'Ban', play: 'Queue' }
const LONG_PREFIX: Record<Ladder, string> = {
  chat: 'Chat ban',
  play: 'Queue ban',
}

export function shortStepLabel(ladder: Ladder, step: LadderStep): string {
  if (step === 'warning') return 'Warn'
  if (step === 'permanent') return 'Perm'
  return `${PREFIX[ladder]} ${step}`
}

export function nextStepText(ladder: Ladder, step: LadderStep): string {
  if (step === 'warning') return 'warning'
  return `${LONG_PREFIX[ladder]} ${step}`
}

export function ladderTrack(
  ladder: Ladder,
  summary: LadderSummary
): { step: LadderStep; label: string; state: StepState }[] {
  const used = new Set(summary.counting.map((s) => s.appliedStep))
  return summary.steps.map((step) => ({
    step,
    label: shortStepLabel(ladder, step),
    state:
      step === summary.recommended ? 'next' : used.has(step) ? 'hit' : 'ahead',
  }))
}

export function ladderSentence(ladder: Ladder, summary: LadderSummary): string {
  const n = summary.counting.length
  const strikes = `${n} ${n === 1 ? 'strike' : 'strikes'}.`
  return `${strikes} Next step: ${nextStepText(ladder, summary.recommended)}.`
}
