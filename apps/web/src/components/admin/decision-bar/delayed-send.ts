// The delayed send behind the staff decision bar. A started send waits
// UNDO_MS, then runs. Undo inside that time drops it, so nothing reaches the
// server. The wait lives here and not in a component, so leaving the page or
// opening another item does not cancel it.
export const UNDO_MS = 5_000

export interface SendJob {
  // Says what the send is about (for example the queue item), so a page can
  // tell which of its things wait.
  tag?: string
  // What the Undo strip says, for example "Chat ban 24h for Kyro".
  label: string
  run: () => Promise<unknown>
  onDone?: (result: unknown) => void
  onError?: (error: Error) => void
  // Runs when staff undo the send, so a page can bring them back to its thing.
  onUndo?: () => void
}

export interface PendingSend {
  id: number
  tag?: string
  label: string
  startedAt: number
  delayMs: number
}

export interface Timers {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class DelayedSend {
  private current: {
    pending: PendingSend
    job: SendJob
    handle: unknown
  } | null = null
  private nextId = 1
  private listeners = new Set<() => void>()

  constructor(
    private readonly timers: Timers = realTimers,
    private readonly delayMs: number = UNDO_MS,
  ) {}

  // The send that is waiting, or null. The object is the same until the send
  // changes, so it works as a store snapshot.
  get pending(): PendingSend | null {
    return this.current?.pending ?? null
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): PendingSend | null => this.pending

  // One send waits at a time: a new one sends the earlier one now.
  start(job: SendJob): PendingSend {
    this.flush()
    const pending: PendingSend = {
      id: this.nextId++,
      tag: job.tag,
      label: job.label,
      startedAt: this.timers.now(),
      delayMs: this.delayMs,
    }
    const handle = this.timers.setTimeout(() => this.flush(), this.delayMs)
    this.current = { pending, job, handle }
    this.emit()
    return pending
  }

  // Drops the waiting send. Returns false when none waits.
  undo(): boolean {
    const cur = this.current
    if (!cur) return false
    this.timers.clearTimeout(cur.handle)
    this.current = null
    this.emit()
    cur.job.onUndo?.()
    return true
  }

  // Sends the waiting send now.
  flush(): void {
    const cur = this.current
    if (!cur) return
    this.timers.clearTimeout(cur.handle)
    this.current = null
    this.emit()
    cur.job
      .run()
      .then((result) => cur.job.onDone?.(result))
      .catch((error: unknown) =>
        cur.job.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        ),
      )
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }
}

// The one sender every staff page shares.
export const staffSend = new DelayedSend()

// Closing the tab still sends what waits.
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => staffSend.flush())
