<script setup lang="ts">
import { useAuth } from '~/composables/useAuth'

const auth = useAuth()
const mobileOpen = ref(false)

function closeMobile() { mobileOpen.value = false }
</script>

<template>
	<nav class="nav">
		<NuxtLink to="/" class="nav-brand" @click="closeMobile">
			<img src="/logo.png" alt="Balatro Multiplayer" class="nav-logo" />
			<span class="nav-title">Balatro Multiplayer</span>
		</NuxtLink>

		<!-- Desktop links -->
		<div class="nav-links">
			<NuxtLink to="/docs" class="nav-link">Docs</NuxtLink>
			<NuxtLink to="/leaderboard" class="nav-link">Leaderboard</NuxtLink>
			<NuxtLink to="/stats" class="nav-link">Stats</NuxtLink>
			<NuxtLink to="/support-us" class="nav-link">Support Us</NuxtLink>
			<NuxtLink v-if="auth.isLoggedIn" to="/account" class="nav-link">Account</NuxtLink>
			<NuxtLink v-if="!auth.isLoggedIn" to="/login">
				<BBtn color="coral" size="sm">Sign In</BBtn>
			</NuxtLink>
			<button v-else class="nav-avatar-btn" @click="auth.logout">
				<span class="nav-name">{{ auth.player?.displayName }}</span>
				<span class="nav-sign-out">Sign out</span>
			</button>
		</div>

		<!-- Mobile hamburger -->
		<button class="nav-hamburger" :class="{ open: mobileOpen }" @click="mobileOpen = !mobileOpen" aria-label="Toggle menu">
			<span /><span /><span />
		</button>

		<!-- Mobile drawer -->
		<Transition name="mobile-menu">
			<div v-if="mobileOpen" class="mobile-drawer">
				<NuxtLink to="/docs" class="mobile-link" @click="closeMobile">Docs</NuxtLink>
				<NuxtLink to="/leaderboard" class="mobile-link" @click="closeMobile">Leaderboard</NuxtLink>
				<NuxtLink to="/stats" class="mobile-link" @click="closeMobile">Stats</NuxtLink>
				<NuxtLink to="/support-us" class="mobile-link" @click="closeMobile">Support Us</NuxtLink>
				<NuxtLink v-if="auth.isLoggedIn" to="/account" class="mobile-link" @click="closeMobile">Account</NuxtLink>
				<div class="mobile-auth">
					<NuxtLink v-if="!auth.isLoggedIn" to="/login" @click="closeMobile">
						<BBtn color="coral" size="md">Sign In</BBtn>
					</NuxtLink>
					<button v-else class="mobile-signout" @click="() => { auth.logout(); closeMobile() }">
						Sign out ({{ auth.player?.displayName }})
					</button>
				</div>
			</div>
		</Transition>
	</nav>
</template>

<style scoped>
.nav {
	position: relative;
	z-index: 10;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 32px;
	border-bottom: 2px solid rgba(0, 0, 0, 0.25);
	background: rgba(0, 0, 0, 0.2);
	backdrop-filter: blur(4px);
}

.nav-brand {
	display: flex;
	align-items: center;
	gap: 12px;
	color: var(--bal-cream);
	font-size: 15px;
	font-weight: 700;
	text-shadow: 2px 2px 0 rgba(0,0,0,0.4);
}

.nav-logo {
	width: 32px;
	height: 32px;
	image-rendering: pixelated;
}

.nav-links {
	display: flex;
	align-items: center;
	gap: 20px;
}

.nav-link {
	color: var(--bal-teal-gray);
	font-size: 13px;
	font-weight: 700;
	transition: color 0.1s;
}

.nav-link:hover,
.nav-link.router-link-active {
	color: var(--bal-white);
}

.nav-avatar-btn {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	background: none;
	border: none;
	cursor: pointer;
	padding: 0;
}

.nav-name {
	color: var(--bal-cream);
	font-size: 11px;
	font-weight: 700;
	font-family: inherit;
}

.nav-sign-out {
	color: var(--bal-gray-mid);
	font-size: 9px;
	font-family: inherit;
}

.nav-avatar-btn:hover .nav-sign-out {
	color: var(--bal-coral);
}

.nav-avatar-btn:active {
	transform: none;
}

/* Hamburger */
.nav-hamburger {
	display: none;
	flex-direction: column;
	gap: 5px;
	background: none;
	border: none;
	cursor: pointer;
	padding: 6px;
}

.nav-hamburger span {
	display: block;
	width: 22px;
	height: 2px;
	background: var(--bal-teal-gray);
	transition: all 0.2s;
}

/* Mobile drawer */
.mobile-drawer {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	z-index: 50;
	background: var(--bal-panel-dark);
	border-bottom: 2px solid rgba(0,0,0,0.3);
	display: flex;
	flex-direction: column;
	padding: 16px 24px 24px;
	gap: 4px;
}

.mobile-link {
	color: var(--bal-teal-gray);
	font-size: 13px;
	font-weight: 700;
	padding: 10px 0;
	border-bottom: 1px solid rgba(0,0,0,0.2);
}

.mobile-link:hover { color: var(--bal-white); }

.mobile-auth {
	margin-top: 16px;
}

.mobile-signout {
	background: none;
	border: none;
	cursor: pointer;
	color: var(--bal-coral);
	font-family: inherit;
	font-size: 11px;
	font-weight: 700;
	padding: 0;
}

.mobile-menu-enter-active,
.mobile-menu-leave-active { transition: opacity 0.15s, transform 0.15s; }
.mobile-menu-enter-from,
.mobile-menu-leave-to { opacity: 0; transform: translateY(-8px); }

@media (max-width: 768px) {
	.nav-links { display: none; }
	.nav-hamburger { display: flex; }
}
</style>
