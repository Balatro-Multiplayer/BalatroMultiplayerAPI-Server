import { defineStore } from 'pinia'

interface Player {
	id: string
	displayName: string
	steamName: string
	useDiscordName: boolean
	preferredJoker: string | null
	discordLinked: boolean
	discordUsername: string | null
}

const useAuthStore = defineStore('auth', () => {
	const player = ref<Player | null>(null)
	const pending = ref(false)

	const isLoggedIn = computed(() => player.value !== null)

	function getToken(): string | null {
		if (import.meta.server) return null
		return localStorage.getItem('bmp_token')
	}

	function setToken(token: string) {
		localStorage.setItem('bmp_token', token)
	}

	function clearToken() {
		localStorage.removeItem('bmp_token')
	}

	async function fetchMe(): Promise<string | null> {
		const token = getToken()
		if (!token) return null
		pending.value = true
		try {
			const config = useRuntimeConfig()
			const data = await $fetch<Player>(`${config.public.apiBase}/auth/me`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			player.value = data
			return null
		} catch (err: unknown) {
			// Only clear state if this fetch's token is still the active one.
			// Guards against a stale background fetch clobbering a concurrent loginWithToken.
			if (getToken() === token) {
				clearToken()
				player.value = null
			}
			const msg = (err as { data?: { error?: string }; message?: string })?.data?.error
				?? (err as { message?: string })?.message
				?? String(err)
			return msg
		} finally {
			pending.value = false
		}
	}

	async function loginWithToken(token: string): Promise<string | null> {
		setToken(token)
		return fetchMe()
	}

	async function logout() {
		const token = getToken()
		if (token) {
			const config = useRuntimeConfig()
			try {
				await $fetch(`${config.public.apiBase}/auth/logout`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}` },
				})
			} catch { /* best-effort */ }
		}
		clearToken()
		player.value = null
		navigateTo('/')
	}

	return { player, pending, isLoggedIn, getToken, loginWithToken, logout, fetchMe }
})

export function useAuth() {
	return useAuthStore()
}
