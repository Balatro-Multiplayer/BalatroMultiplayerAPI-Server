<script setup lang="ts">
definePageMeta({ ssr: false })

const auth = useAuth()
const config = useRuntimeConfig()

onMounted(async () => {
	if (!auth.isLoggedIn && !auth.pending) {
		navigateTo('/login')
		return
	}
	if (discordLinkSuccess.value) {
		await auth.fetchMe()
	}
})

watchEffect(() => {
	if (!auth.pending && !auth.isLoggedIn) {
		navigateTo('/login')
	}
})

const discordLinking = ref(false)
const discordUnlinking = ref(false)
const discordLinkSuccess = ref(useRoute().query.discord === 'linked')

const deleteConfirm = ref('')
const deleting = ref(false)
const deleteError = ref('')

async function deleteAccount() {
	if (deleteConfirm.value !== 'DELETE') return
	deleting.value = true
	deleteError.value = ''
	try {
		const token = auth.getToken()
		await $fetch(`${config.public.apiBase}/auth/account`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		auth.logout()
	} catch {
		deleteError.value = 'Something went wrong. Please try again or contact bmp@virtualized.dev.'
		deleting.value = false
	}
}

async function linkDiscord() {
	discordLinking.value = true
	try {
		const token = auth.getToken()
		const data = await $fetch<{ url: string }>(`${config.public.apiBase}/auth/link/discord?source=web`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
		window.location.href = data.url
	} catch {
		discordLinking.value = false
	}
}

async function unlinkDiscord() {
	discordUnlinking.value = true
	try {
		const token = auth.getToken()
		await $fetch(`${config.public.apiBase}/auth/unlink/discord`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
		await auth.fetchMe()
	} finally {
		discordUnlinking.value = false
	}
}
</script>

<template>
	<div class="account-page">
		<h1 class="page-title">Account</h1>

		<div v-if="auth.pending" class="state-msg">Loading...</div>

		<div v-else-if="auth.player" class="account-grid">
			<!-- Profile panel -->
			<BPanel variant="default" class="profile-panel">
				<h2 class="panel-heading">Profile</h2>
				<div class="profile-row">
					<span class="profile-label">Display Name</span>
					<span class="profile-value">{{ auth.player?.displayName }}</span>
				</div>
				<div class="profile-row">
					<span class="profile-label">Steam Name</span>
					<span class="profile-value profile-value--sub">{{ auth.player?.steamName }}</span>
				</div>
				<div class="profile-row">
					<span class="profile-label">Player ID</span>
					<span class="profile-value profile-value--mono">{{ auth.player?.id }}</span>
				</div>
			</BPanel>

			<!-- Discord panel -->
			<BPanel variant="default" class="discord-panel">
				<h2 class="panel-heading">Discord</h2>
				<p v-if="discordLinkSuccess" class="discord-success">Discord linked successfully!</p>
				<div v-if="auth.player?.discordLinked" class="discord-linked">
					<p class="discord-status">Discord account linked</p>
					<p v-if="auth.player?.discordUsername" class="discord-id">
						{{ auth.player?.discordUsername }}
					</p>
					<BBtn
						color="coral"
						size="sm"
						:disabled="discordUnlinking"
						@click="unlinkDiscord"
					>
						{{ discordUnlinking ? 'Unlinking...' : 'Unlink Discord' }}
					</BBtn>
				</div>
				<div v-else class="discord-unlinked">
					<p class="discord-status">No Discord account linked</p>
					<p class="discord-note">Link Discord to get mod notifications and access Discord-exclusive features.</p>
					<BBtn
						color="purple"
						size="sm"
						:disabled="discordLinking"
						@click="linkDiscord"
					>
						{{ discordLinking ? 'Redirecting...' : 'Link Discord' }}
					</BBtn>
				</div>
			</BPanel>
			<!-- Danger zone -->
			<BPanel variant="dark" class="danger-panel">
				<h2 class="panel-heading danger-heading">Danger Zone</h2>
				<p class="danger-desc">Deleting your account is permanent. Your profile, ratings, and match history will be removed. Type <strong>DELETE</strong> to confirm.</p>
				<div class="danger-row">
					<input
						v-model="deleteConfirm"
						class="danger-input"
						type="text"
						placeholder="Type DELETE to confirm"
						:disabled="deleting"
					/>
					<BBtn
						color="coral"
						size="sm"
						:disabled="deleteConfirm !== 'DELETE' || deleting"
						@click="deleteAccount"
					>
						{{ deleting ? 'Deleting...' : 'Delete Account' }}
					</BBtn>
				</div>
				<p v-if="deleteError" class="danger-error">{{ deleteError }}</p>
			</BPanel>
		</div>
	</div>
</template>

<style scoped>
.account-page { max-width: 720px; margin: 0 auto; }

.page-title {
	font-size: 20px;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	margin-bottom: 24px;
}

.account-grid {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.panel-heading {
	font-size: 13px;
	color: var(--bal-cream);
	margin-bottom: 16px;
	text-transform: uppercase;
	letter-spacing: 0.06em;
}

.profile-row {
	display: flex;
	align-items: baseline;
	gap: 12px;
	padding: 8px 0;
	border-bottom: 1px solid rgba(0,0,0,0.2);
}

.profile-row:last-child { border-bottom: none; }

.profile-label {
	color: var(--bal-teal-gray);
	font-size: 9px;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	min-width: 120px;
	flex-shrink: 0;
}

.profile-value {
	color: var(--bal-white);
	font-size: 11px;
}

.profile-value--sub  { color: var(--bal-gray-blue); }
.profile-value--mono { color: var(--bal-gray-mid); font-size: 9px; }

.discord-linked,
.discord-unlinked {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.discord-status  { font-size: 11px; color: var(--bal-white); }
.discord-id      { font-size: 9px; color: var(--bal-gray-mid); }
.discord-success { font-size: 10px; color: var(--bal-green); margin-bottom: 8px; }

.discord-note {
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 1.8;
}

.state-msg {
	text-align: center;
	padding: 60px;
	color: var(--bal-teal-gray);
	font-size: 13px;
}

.danger-panel { border: 1px solid rgba(253, 95, 85, 0.25) !important; }

.danger-heading { color: var(--bal-coral) !important; }

.danger-desc {
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 1.8;
	margin-bottom: 16px;
}

.danger-desc strong { color: var(--bal-white); }

.danger-row {
	display: flex;
	gap: 10px;
	align-items: center;
}

.danger-input {
	flex: 1;
	background: rgba(0, 0, 0, 0.3);
	border: 1px solid rgba(253, 95, 85, 0.3);
	border-radius: 8px;
	padding: 8px 12px;
	color: var(--bal-white);
	font-family: inherit;
	font-size: 10px;
	outline: none;
}

.danger-input:focus { border-color: var(--bal-coral); }

.danger-error {
	font-size: 9px;
	color: var(--bal-coral);
	margin-top: 10px;
}
</style>
