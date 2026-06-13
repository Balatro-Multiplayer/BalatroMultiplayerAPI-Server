<script setup lang="ts">
definePageMeta({ ssr: false })

const route = useRoute()
const auth = useAuth()
const config = useRuntimeConfig()

const pendingToken = route.query.token as string | undefined
const accepting = ref(false)
const error = ref('')
const blocked = ref(false)

if (!pendingToken) navigateTo('/login')

function getCookie(name: string): string | null {
	const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
	return match ? decodeURIComponent(match[2]) : null
}

function setCookie(name: string, value: string, hours: number) {
	const expires = new Date(Date.now() + hours * 60 * 60 * 1000).toUTCString()
	document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

onMounted(() => {
	if (getCookie('account_blocked') === '1') {
		blocked.value = true
	}
})

const birthDate = ref('')
const agreed = ref(false)

const age = computed(() => {
	if (!birthDate.value) return null
	const today = new Date()
	const dob = new Date(birthDate.value)
	let a = today.getFullYear() - dob.getFullYear()
	const m = today.getMonth() - dob.getMonth()
	if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) a--
	return a
})

const maxDate = computed(() => new Date().toISOString().split('T')[0])

const canAccept = computed(() => birthDate.value !== '' && agreed.value)

async function accept() {
	if (!pendingToken || !canAccept.value) return

	if (age.value !== null && age.value < 13) {
		setCookie('account_blocked', '1', 48)
		blocked.value = true
		return
	}

	accepting.value = true
	error.value = ''
	try {
		const chatEligible = age.value !== null && age.value >= 16
		const data = await $fetch<{ token: string }>(`${config.public.apiBase}/auth/accept-tos`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${pendingToken}` },
			body: { chatEligible },
		})
		await auth.loginWithToken(data.token)
		navigateTo('/account')
	} catch {
		error.value = 'Something went wrong. Please try signing in again.'
		accepting.value = false
	}
}
</script>

<template>
	<div class="tos-gate">
		<!-- Blocked screen -->
		<BPanel v-if="blocked" variant="dark" class="tos-panel">
			<h1 class="tos-title">Account creation is unavailable</h1>
			<NuxtLink to="/">
				<BBtn color="dark" size="sm">Back to home</BBtn>
			</NuxtLink>
		</BPanel>

		<!-- Normal flow -->
		<BPanel v-else variant="dark" class="tos-panel">
			<h1 class="tos-title">Before you play</h1>
			<p class="tos-sub">A couple of things to sort out first</p>

			<div class="section">
				<p class="section-label">Your birthday</p>
				<p class="section-hint">We won't store it, we just need to check that you are old enough to play.</p>
				<input
					v-model="birthDate"
					class="date-input"
					type="date"
					:max="maxDate"
				/>
			</div>

			<div class="section">
				<p class="section-label">What you're agreeing to</p>
				<ul class="points">
					<li>We save your Steam display name, hashed identifiers, and match results.</li>
					<li>We don't sell your data or use it for ads. Ever.</li>
					<li>You can delete your account from the account page at any time.</li>
				</ul>
				<NuxtLink to="/notice" target="_blank" class="notice-link">Full Privacy &amp; Terms Notice ↗</NuxtLink>
				<label class="agree-label">
					<input v-model="agreed" type="checkbox" class="agree-check" />
					I have read and agree to the Privacy &amp; Terms Notice
				</label>
			</div>

			<p v-if="error" class="tos-error">{{ error }}</p>

			<div class="tos-actions">
				<NuxtLink to="/login"><BBtn color="dark" size="sm">Cancel</BBtn></NuxtLink>
				<BBtn color="blue" :disabled="!canAccept || accepting" @click="accept">
					{{ accepting ? 'Creating account...' : 'Create Account' }}
				</BBtn>
			</div>
		</BPanel>
	</div>
</template>

<style scoped>
.tos-gate {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 70vh;
}

.tos-panel {
	max-width: 480px;
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 24px;
}

.tos-title {
	font-size: 20px;
	color: var(--bal-cream);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
}

.tos-sub {
	font-size: 9px;
	color: var(--bal-teal-gray);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	margin-top: -16px;
}

.section {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.section-label {
	font-size: 9px;
	color: var(--bal-cream);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.section-hint {
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 1.7;
	margin-top: -4px;
}

.date-input {
	background: rgba(0,0,0,0.3);
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 8px;
	padding: 8px 12px;
	color: var(--bal-white);
	font-family: inherit;
	font-size: 11px;
	outline: none;
	width: 100%;
	color-scheme: dark;
}

.date-input:focus { border-color: var(--bal-blue); }

.points {
	padding-left: 16px;
	display: flex;
	flex-direction: column;
	gap: 6px;
	list-style: disc;
}

.points li {
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 1.8;
}

.notice-link {
	font-size: 9px;
	color: var(--bal-blue);
}

.notice-link:hover { color: var(--bal-blue-light); }

.agree-label {
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 9px;
	color: var(--bal-teal-gray);
	cursor: pointer;
	user-select: none;
}

.agree-check {
	width: 14px;
	height: 14px;
	flex-shrink: 0;
	accent-color: var(--bal-blue);
	cursor: pointer;
}

.tos-error {
	font-size: 9px;
	color: var(--bal-coral);
}

.tos-actions {
	display: flex;
	gap: 10px;
	justify-content: flex-end;
}
</style>
