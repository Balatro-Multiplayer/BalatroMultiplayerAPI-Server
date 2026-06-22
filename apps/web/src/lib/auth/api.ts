import { apiFetch } from '../api'
import type { Player } from './types'

export async function fetchCurrentPlayer(): Promise<Player> {
  return apiFetch<Player>('/auth/me')
}

export async function callLogout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' })
  } catch {
    // best-effort
  }
}
