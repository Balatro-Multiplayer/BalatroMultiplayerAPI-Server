'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError } from '../api'
import { fetchCurrentPlayer, callLogout } from './api'
import { getToken, setToken, clearToken } from './token'
import { isAdmin, isModerator } from './privilege-checks'
import type { Player } from './types'

export function useAuth() {
  const [player, setPlayer] = useState<Player | null>(null)
  const [pending, setPending] = useState(true)
  const router = useRouter()

  const fetchMe = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setPending(false)
      return null
    }
    setPending(true)
    try {
      const data = await fetchCurrentPlayer()
      setPlayer(data)
      return data
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken()
      }
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
    await callLogout()
    clearToken()
    setPlayer(null)
    router.push('/')
  }, [router])

  return {
    player,
    pending,
    isLoggedIn: player !== null,
    isAdmin: isAdmin(player),
    isModerator: isModerator(player),
    loginWithToken,
    logout,
    fetchMe,
  }
}
