<script setup lang="ts">
definePageMeta({ layout: 'docs' })
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Introduction</h1>
		<p class="doc-lead">Balatro Multiplayer is a mod for Balatro that allows you to play with your friends or against other players.</p>

		<div class="cards-grid">
			<NuxtLink to="/docs/getting-started/installation" class="doc-card">
				<div class="doc-card-icon" style="background: var(--bal-blue)">⬇</div>
				<div>
					<div class="doc-card-title">Installation</div>
					<div class="doc-card-desc">Learn how to install the mod.</div>
				</div>
			</NuxtLink>
			<NuxtLink to="/docs/getting-started/faq" class="doc-card">
				<div class="doc-card-icon" style="background: var(--bal-amber)">?</div>
				<div>
					<div class="doc-card-title">FAQ</div>
					<div class="doc-card-desc">Answers to common questions.</div>
				</div>
			</NuxtLink>
			<NuxtLink to="/docs/multiplayer-content/approved-mods" class="doc-card">
				<div class="doc-card-icon" style="background: var(--bal-green)">✓</div>
				<div>
					<div class="doc-card-title">Approved Mods</div>
					<div class="doc-card-desc">Explicitly approved mods for ranked and queue.</div>
				</div>
			</NuxtLink>
			<NuxtLink to="/docs/multiplayer-content/banned-mods" class="doc-card">
				<div class="doc-card-icon" style="background: var(--bal-coral)">✗</div>
				<div>
					<div class="doc-card-title">Banned Mods</div>
					<div class="doc-card-desc">List of banned mods and reasons.</div>
				</div>
			</NuxtLink>
			<NuxtLink to="/docs/ranked-matchmaking/introduction" class="doc-card">
				<div class="doc-card-icon" style="background: var(--bal-purple)">★</div>
				<div>
					<div class="doc-card-title">Ranked Matchmaking</div>
					<div class="doc-card-desc">How competitive play and MMR work.</div>
				</div>
			</NuxtLink>
			<NuxtLink to="/docs/advanced/private-server" class="doc-card">
				<div class="doc-card-icon" style="background: var(--bal-panel-light)">⚙</div>
				<div>
					<div class="doc-card-title">Private Server</div>
					<div class="doc-card-desc">Host your own server for your friends.</div>
				</div>
			</NuxtLink>
		</div>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 {
	font-size: 22px;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	margin-bottom: 16px;
}
.doc-lead {
	font-size: 10px;
	color: var(--bal-teal-gray);
	line-height: 2.2;
	margin-bottom: 32px;
	max-width: 540px;
}
.cards-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 12px;
}
.doc-card {
	display: flex;
	align-items: flex-start;
	gap: 14px;
	background: var(--bal-panel);
	border: 3px solid var(--bal-panel-dark);
	box-shadow: inset 0 2px 6px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.4);
	border-radius: 14px;
	padding: 18px;
	transition: background 0.15s;
}
.doc-card:hover { background: var(--bal-panel-light); }
.doc-card-icon {
	width: 36px;
	height: 36px;
	border-radius: 10px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 16px;
	flex-shrink: 0;
	box-shadow: 0 2px 0 rgba(0,0,0,0.3);
}
.doc-card-title {
	font-size: 11px;
	color: var(--bal-cream);
	font-weight: 700;
	margin-bottom: 4px;
}
.doc-card-desc {
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 2;
}
@media (max-width: 500px) { .cards-grid { grid-template-columns: 1fr; } }
</style>
