<script setup lang="ts">
const route = useRoute()
const auth = useAuth()
const error = ref('')

onMounted(async () => {
	const token = route.query.token as string | undefined
	if (!token) {
		error.value = 'No token received.'
		return
	}
	await auth.loginWithToken(token)
	if (auth.isLoggedIn) {
		navigateTo('/account')
	} else {
		error.value = 'Authentication failed. Please try again.'
	}
})
</script>

<template>
	<div class="callback">
		<BPanel v-if="error" variant="dark" class="callback-panel">
			<p class="callback-error">{{ error }}</p>
			<NuxtLink to="/login"><BBtn color="coral">Try Again</BBtn></NuxtLink>
		</BPanel>
		<BPanel v-else variant="dark" class="callback-panel">
			<p class="callback-msg">Signing you in...</p>
		</BPanel>
	</div>
</template>

<style scoped>
.callback {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 60vh;
}

.callback-panel {
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 20px;
}

.callback-msg { color: var(--bal-teal-gray); font-size: 13px; }
.callback-error { color: var(--bal-coral); font-size: 13px; }
</style>
