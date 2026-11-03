// Score text -> number for display and comparison only. Replay logs carry
// scores as text (tostring of an arbitrary-size number), which is exact for
// the common range; past a double, ordering is by exponent, which is enough
// to pick a winner and label a hand.

export function scoreNumber(text: unknown): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null
  if (typeof text !== 'string') return null
  const cleaned = text.trim().replace(/,/g, '').toLowerCase()
  if (cleaned === '') return null
  if (cleaned === 'naneinf' || cleaned === 'inf' || cleaned === 'infinity') {
    return Number.MAX_VALUE
  }
  const value = Number(cleaned)
  return Number.isNaN(value) ? null : value
}

export function formatScore(text: string | null): string {
  const value = scoreNumber(text)
  if (value === null) return text ?? '-'
  if (value >= 1e11) return value.toExponential(2).replace('+', '')
  return Math.round(value).toLocaleString()
}

/** The increase from `previous` to `next`; a drop means a new blind began. */
export function scoreGain(
  previous: string | null,
  next: string | null
): string | null {
  const b = scoreNumber(next)
  if (b === null) return null
  const a = scoreNumber(previous)
  if (a === null || b < a) return String(b)
  return String(b - a)
}

export function compareScoreText(a: string, b: string): number {
  return (scoreNumber(a) ?? 0) - (scoreNumber(b) ?? 0)
}
