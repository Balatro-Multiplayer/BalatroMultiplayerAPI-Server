import { EventEmitter } from 'node:events'
export const globalEmitter = new EventEmitter()
export function createEventIterator<T>(
  emitter: EventEmitter,
  eventName: string,
  opts?: { signal?: AbortSignal }
): AsyncIterableIterator<[T]> {
  const events: [T][] = []
  let resolvePromise: (() => void) | null = null
  let done = false

  const push = (data: T) => {
    events.push([data])
    if (resolvePromise) {
      resolvePromise()
      resolvePromise = null
    }
  }

  const cleanup = () => {
    done = true
    emitter.off(eventName, push)
    if (resolvePromise) {
      resolvePromise()
    }
  }

  emitter.on(eventName, push)
  opts?.signal?.addEventListener('abort', cleanup)

  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (events.length > 0) {
        const value = events.shift()
        if (value !== undefined) {
          return { value, done: false }
        }
      }
      if (done) {
        return { value: undefined, done: true }
      }
      await new Promise<void>((resolve) => {
        resolvePromise = resolve
      })
      return this.next()
    },
    async return() {
      cleanup()
      return { value: undefined, done: true }
    },
    async throw(error) {
      cleanup()
      throw error
    },
  }
}
