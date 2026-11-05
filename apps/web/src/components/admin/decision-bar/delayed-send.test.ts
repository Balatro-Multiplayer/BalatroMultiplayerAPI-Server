import { describe, expect, test } from 'bun:test'
import { DelayedSend, type SendJob, type Timers } from './delayed-send'

// A clock the test moves by hand.
function fakeTimers() {
  let now = 0
  let next = 1
  const due = new Map<number, { at: number; fn: () => void }>()
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      due.set(next, { at: now + ms, fn })
      return next++
    },
    clearTimeout: (h) => void due.delete(h as number),
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...due])
      if (t.at <= now) {
        due.delete(id)
        t.fn()
      }
  }
  return { timers, advance }
}

function job(
  sent: string[],
  name: string,
  extra: Partial<SendJob> = {},
): SendJob {
  return {
    label: name,
    run: async () => {
      sent.push(name)
      return name
    },
    ...extra,
  }
}

describe('DelayedSend', () => {
  test('sends nothing before the delay runs out', () => {
    const { timers, advance } = fakeTimers()
    const sent: string[] = []
    const s = new DelayedSend(timers, 5000)
    s.start(job(sent, 'a'))
    advance(4999)
    expect(sent).toEqual([])
    expect(s.pending?.label).toBe('a')
  })

  test('sends once when the delay runs out', () => {
    const { timers, advance } = fakeTimers()
    const sent: string[] = []
    const s = new DelayedSend(timers, 5000)
    s.start(job(sent, 'a'))
    advance(5000)
    advance(10000)
    expect(sent).toEqual(['a'])
    expect(s.pending).toBeNull()
  })

  test('undo inside the delay sends nothing, ever', () => {
    const { timers, advance } = fakeTimers()
    const sent: string[] = []
    const s = new DelayedSend(timers, 5000)
    s.start(job(sent, 'a'))
    advance(3000)
    expect(s.undo()).toBe(true)
    advance(10000)
    expect(sent).toEqual([])
    expect(s.pending).toBeNull()
  })

  test('undo with nothing waiting does nothing', () => {
    const { timers } = fakeTimers()
    expect(new DelayedSend(timers, 5000).undo()).toBe(false)
  })

  test('a second send sends the first one now and waits on its own', () => {
    const { timers, advance } = fakeTimers()
    const sent: string[] = []
    const s = new DelayedSend(timers, 5000)
    s.start(job(sent, 'a'))
    advance(1000)
    s.start(job(sent, 'b'))
    expect(sent).toEqual(['a'])
    advance(4999)
    expect(sent).toEqual(['a'])
    advance(1)
    expect(sent).toEqual(['a', 'b'])
  })

  test('flush sends a waiting send at once, as leaving the page does', () => {
    const { timers, advance } = fakeTimers()
    const sent: string[] = []
    const s = new DelayedSend(timers, 5000)
    s.start(job(sent, 'a'))
    s.flush()
    expect(sent).toEqual(['a'])
    advance(10000)
    expect(sent).toEqual(['a'])
  })

  test('the strip knows when the send started and how long it waits', () => {
    const { timers, advance } = fakeTimers()
    const s = new DelayedSend(timers, 5000)
    advance(700)
    const p = s.start(job([], 'a'))
    expect(p.startedAt).toBe(700)
    expect(p.delayMs).toBe(5000)
  })

  test('subscribers hear each change', () => {
    const { timers } = fakeTimers()
    const s = new DelayedSend(timers, 5000)
    let calls = 0
    s.subscribe(() => calls++)
    s.start(job([], 'a'))
    s.undo()
    expect(calls).toBe(2)
  })

  test('onDone and onError report the result of the send', async () => {
    const { timers } = fakeTimers()
    const s = new DelayedSend(timers, 5000)
    const seen: string[] = []
    s.start(job([], 'ok', { onDone: (r) => void seen.push(`done ${r}`) }))
    s.flush()
    s.start({
      label: 'bad',
      run: async () => {
        throw new Error('refused')
      },
      onError: (e) => void seen.push(`error ${e.message}`),
    })
    s.flush()
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['done ok', 'error refused'])
  })
})
