'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api'

export interface Player {
  id: string
  displayName: string
  steamName: string
  useDiscordName: boolean
  preferredJoker: string | null
  discordLinked: boolean
  discordUsername: string | null
  privileges: string[]
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('bmp_token')
}

export function setToken(token: string) {
  localStorage.setItem('bmp_token', token)
}

export function clearToken() {
  localStorage.removeItem('bmp_token')
}

export function useAuth() {
  const [player, setPlayer] = useState<Player | null>(null)
  const [pending, setPending] = useState(true)

  const fetchMe = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setPending(false)
      return null
    }
    setPending(true)
    try {
      const data = await apiFetch<Player>('/auth/me')
      setPlayer(data)
      return data
    } catch {
      clearToken()
      setPlayer(null)
      return null
    } finally {
      setPending(false)
    }
  }, [])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  const loginWithToken = useCallback(
    async (token: string) => {
      setToken(token)
      return fetchMe()
    },
    [fetchMe],
  )

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      /* best-effort */
    }
    clearToken()
    setPlayer(null)
    window.location.href = '/'
  }, [])

  return {
    player,
    pending,
    isLoggedIn: player !== null,
    isAdmin: player?.privileges?.includes('admin') ?? false,
    isModerator:
      player?.privileges?.includes('moderator') ||
      player?.privileges?.includes('admin') ||
      false,
    loginWithToken,
    logout,
    fetchMe,
  }
}
