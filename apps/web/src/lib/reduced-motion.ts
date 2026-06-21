'use client'

import { useSyncExternalStore } from 'react'

// Shared "reduce motion" preference. Persisted to localStorage, defaulting to the
// OS prefers-reduced-motion setting. Both the motion toggle and the animated
// background subscribe to it.
const KEY = 'bmp_reduce_motion'
const listeners = new Set<() => void>()
let current: boolean | null = null

function compute(): boolean {
  if (typeof window === 'undefined') return false
  const stored = window.localStorage.getItem(KEY)
  if (stored !== null) return stored === '1'
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function getSnapshot(): boolean {
  if (current === null) current = compute()
  return current
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setReducedMotion(value: boolean): void {
  current = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(KEY, value ? '1' : '0')
  }
  for (const l of listeners) l()
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
