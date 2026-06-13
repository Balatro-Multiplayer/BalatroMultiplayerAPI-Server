<script setup lang="ts">
const route = useRoute()
</script>

<template>
	<div class="docs-layout">
		<BalatroSwirl />
		<AppNav />
		<div class="docs-body">
			<DocsNav />
			<main class="docs-main">
				<slot />
			</main>
		</div>
		<footer class="layout-footer">
			<span>Balatro Multiplayer &mdash; not affiliated with LocalThunk or Playstack</span>
			<div class="footer-links">
				<NuxtLink to="/notice">Privacy &amp; Terms</NuxtLink>
			</div>
		</footer>
	</div>
</template>

<style scoped>
.docs-layout {
	position: relative;
	min-height: 100%;
	display: flex;
	flex-direction: column;
}

.docs-body {
	position: relative;
	z-index: 1;
	flex: 1;
	display: flex;
	max-width: 1100px;
	width: 100%;
	margin: 0 auto;
	padding: 24px 16px 48px;
	gap: 24px;
}

.docs-main {
	flex: 1;
	min-width: 0;
}

.layout-footer {
	position: relative;
	z-index: 1;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 16px 32px;
	border-top: 2px solid rgba(0,0,0,0.3);
	background: rgba(0,0,0,0.2);
	font-size: 11px;
	color: var(--bal-gray-mid);
}

.footer-links { display: flex; gap: 20px; }
.footer-links a { color: var(--bal-gray-mid); font-size: 11px; }
.footer-links a:hover { color: var(--bal-teal-gray); }

@media (max-width: 700px) {
	.docs-body { flex-direction: column; padding: 16px 12px 48px; }
}
</style>
