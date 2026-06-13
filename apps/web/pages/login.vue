<script setup lang="ts">
definePageMeta({ ssr: false })

const auth = useAuth()
watchEffect(() => {
	if (!auth.pending && auth.isLoggedIn) {
		navigateTo('/account')
	}
})
</script>

<template>
	<div class="login-page">
		<BPanel variant="dark" class="login-panel">
			<img :src="'/logo.png'" alt="Balatro Multiplayer" class="login-logo" />
			<h1 class="login-title">Balatro Multiplayer</h1>
			<p class="login-sub">Sign in to track your rank and stats</p>

			<a href="/api/auth/steam/web" class="steam-btn">
				<img :src="'/steam-sign-in.png'" alt="Sign in through Steam" class="steam-img" />
			</a>

			<p class="login-note">
				A Steam account is required to play.<br />
				Discord can be linked after sign-in.
			</p>
		</BPanel>
	</div>
</template>

<style scoped>
.login-page {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 70vh;
}

.login-panel {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 20px;
	text-align: center;
	max-width: 400px;
	width: 100%;
}

.login-logo {
	width: 80px;
	height: 80px;
	image-rendering: pixelated;
}

.login-title {
	font-size: 20px;
	color: var(--bal-cream);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
}

.login-sub {
	color: var(--bal-teal-gray);
	font-size: 11px;
}

.steam-btn {
	display: block;
	transition: transform 0.1s;
}

.steam-btn:hover { transform: translateY(-2px); }
.steam-btn:active { transform: translateY(1px); }

.steam-img {
	height: 48px;
	image-rendering: auto;
}

.login-note {
	color: var(--bal-gray-mid);
	font-size: 9px;
	line-height: 1.8;
}
</style>
