<script setup lang="ts">
const route = useRoute()

const sections = [
	{
		title: 'Getting Started',
		items: [
			{ label: 'Introduction', path: '/docs' },
			{ label: 'Installation', path: '/docs/getting-started/installation' },
			{ label: 'FAQ', path: '/docs/getting-started/faq' },
		],
	},
	{
		title: 'Ranked Matchmaking',
		items: [
			{ label: 'Introduction', path: '/docs/ranked-matchmaking/introduction' },
		],
	},
	{
		title: 'Rulesets',
		items: [
			{ label: 'Standard Ranked', path: '/docs/rulesets/standard' },
		],
	},
	{
		title: 'Game Modes',
		items: [
			{ label: 'List of Game Modes', path: '/docs/gamemodes' },
		],
	},
	{
		title: 'Multiplayer Content',
		items: [
			{ label: 'Approved Mods', path: '/docs/multiplayer-content/approved-mods' },
			{ label: 'Banned Mods', path: '/docs/multiplayer-content/banned-mods' },
		],
	},
	{
		title: 'Advanced',
		items: [
			{ label: 'Private Server Setup', path: '/docs/advanced/private-server' },
		],
	},
]

function isActive(path: string) {
	return route.path === path
}
</script>

<template>
	<aside class="docs-nav">
		<div v-for="section in sections" :key="section.title" class="nav-section">
			<div class="section-title">{{ section.title }}</div>
			<NuxtLink
				v-for="item in section.items"
				:key="item.path"
				:to="item.path"
				class="nav-item"
				:class="{ 'nav-item--active': isActive(item.path) }"
			>
				{{ item.label }}
			</NuxtLink>
		</div>
	</aside>
</template>

<style scoped>
.docs-nav {
	width: 220px;
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: 24px;
}

.nav-section {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.section-title {
	font-size: 8px;
	color: var(--bal-gray-mid);
	text-transform: uppercase;
	letter-spacing: 0.1em;
	margin-bottom: 6px;
	padding: 0 10px;
}

.nav-item {
	display: block;
	padding: 7px 10px;
	border-radius: 8px;
	font-size: 10px;
	color: var(--bal-teal-gray);
	font-weight: 700;
	transition: color 0.1s, background 0.1s;
}

.nav-item:hover {
	color: var(--bal-white);
	background: rgba(255,255,255,0.05);
}

.nav-item--active {
	color: var(--bal-cream);
	background: rgba(253,95,85,0.12);
	border-left: 2px solid var(--bal-coral);
}

@media (max-width: 700px) {
	.docs-nav {
		width: 100%;
		flex-direction: row;
		flex-wrap: wrap;
		gap: 8px;
	}

	.nav-section { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 4px; }
	.section-title { display: none; }
	.nav-item { font-size: 9px; }
}
</style>
