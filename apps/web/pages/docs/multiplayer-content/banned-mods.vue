<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const banRules = [
	'Mods that add non-multiplayer gameplay content (new jokers/tarots/planets/etc.) are banned.',
	'Mods that increase speed above 4× are banned.',
	'Mods that reveal hidden card/deck info (including top-deck preview or misprint-tech helpers) are banned.',
]

const banned = [
	{ name: 'Incantation', reason: 'Allows stacking consumables beyond consumable slots', alt: null },
	{ name: 'Brainstorm', reason: 'Save states', alt: null },
	{ name: "Divvy's Preview or DVPreview", reason: 'Gives more information than is available to the player', alt: 'Score Preview Integration' },
	{ name: "Fantom's Preview", reason: 'Conflicts with Multiplayer due to Score Preview Integration', alt: 'Score Preview Integration' },
	{ name: 'Aura', reason: 'Not actually banned but will crash if you copy a flash card', alt: null },
	{ name: 'NotJustYet', reason: 'Allows you to farm past the blind cap', alt: null },
	{ name: 'Showman', reason: 'In-game seed analysis', alt: null },
	{ name: 'Tag Preview', reason: 'Gives more information than is available to the player', alt: null },
	{ name: 'QoL Bundle', reason: 'Changes aspects of the game, not QoL in a Multiplayer context', alt: null },
]
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Banned Mods</h1>
		<p class="doc-lead">Do not use these mods in ranked / queue.</p>

		<div class="rule-pills">
			<NuxtLink to="/docs/multiplayer-content/approved-mods" class="pill pill--green">View approved mods →</NuxtLink>
		</div>

		<section class="doc-section">
			<h2 class="doc-h2">General Ban Rules</h2>
			<ul class="rules-list">
				<li v-for="rule in banRules" :key="rule" class="rule-item">
					<span class="rule-dot">✗</span>
					<span>{{ rule }}</span>
				</li>
			</ul>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Extra Banned Mods ({{ banned.length }})</h2>
			<div class="mod-table">
				<div class="mod-row mod-row--header">
					<span>Name</span>
					<span>Reason</span>
					<span>Alternative</span>
				</div>
				<div v-for="mod in banned" :key="mod.name" class="mod-row">
					<span class="mod-name">{{ mod.name }}</span>
					<span class="mod-reason">{{ mod.reason }}</span>
					<span class="mod-alt">{{ mod.alt ?? '—' }}</span>
				</div>
			</div>
		</section>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 { font-size: 22px; color: var(--bal-white); text-shadow: 3px 3px 0 rgba(0,0,0,0.4); margin-bottom: 12px; }
.doc-h2 { font-size: 13px; color: var(--bal-cream); margin-bottom: 12px; font-weight: 700; }
.doc-lead { font-size: 10px; color: var(--bal-teal-gray); line-height: 2.2; margin-bottom: 20px; }
.doc-section { margin-bottom: 32px; }

.rule-pills { display: flex; gap: 8px; margin-bottom: 28px; }
.pill { font-size: 9px; font-weight: 700; padding: 6px 14px; border-radius: 999px; white-space: nowrap; text-decoration: none; }
.pill--green { background: rgba(86,167,134,0.15); color: var(--bal-green); border: 2px solid rgba(86,167,134,0.3); }

.rules-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.rule-item {
	display: flex; align-items: flex-start; gap: 10px;
	font-size: 10px; color: var(--bal-gray-blue); line-height: 2;
}
.rule-dot { color: var(--bal-coral); font-weight: 900; flex-shrink: 0; }

.mod-table {
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-dark);
	border-radius: 12px;
	overflow: auto;
}
.mod-row {
	display: grid;
	grid-template-columns: 1.4fr 2fr 1fr;
	padding: 9px 14px;
	border-bottom: 1px solid rgba(0,0,0,0.15);
	align-items: start;
	gap: 12px;
	min-width: 480px;
}
.mod-row:last-child { border-bottom: none; }
.mod-row--header {
	background: var(--bal-panel-dark);
	font-size: 8px;
	color: var(--bal-gray-blue);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}
.mod-name { font-size: 9px; color: var(--bal-coral); font-weight: 700; }
.mod-reason { font-size: 9px; color: var(--bal-gray-blue); line-height: 1.8; }
.mod-alt { font-size: 9px; color: var(--bal-green); }
</style>
