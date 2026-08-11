export function formatElapsedMs(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  const minutes = Math.floor(abs / 60_000)
  const seconds = Math.floor((abs % 60_000) / 1000)
  const millis = Math.floor(abs % 1000)
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}
