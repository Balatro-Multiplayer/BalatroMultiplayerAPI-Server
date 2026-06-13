<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const modes = [
	{
		name: 'Attrition',
		color: 'var(--bal-coral)',
		icon: '⚔',
		desc: 'Every boss blind after Ante 1 is a nemesis blind. A relentless format that tests your ability to win PvP consistently from the very start.',
	},
	{
		name: 'Showdown',
		color: 'var(--bal-gold)',
		icon: '🏆',
		desc: 'After the first 2 antes, every blind is a nemesis blind. This gamemode gives you time to prepare your build before the real battle begins.',
	},
	{
		name: 'Survival',
		color: 'var(--bal-green)',
		icon: '🌿',
		desc: 'The player who beats the farthest blind wins. No nemesis blinds — this is a pure test of your ability to gradually build up to the highest scoring vanilla hands.',
	},
]
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">List of Game Modes</h1>
		<p class="doc-lead">Overview of the currently available game modes in Balatro Multiplayer.</p>

		<div class="modes-list">
			<div
				v-for="mode in modes"
				:key="mode.name"
				class="mode-card"
				:style="{ '--accent': mode.color }"
			>
				<div class="mode-icon" :style="{ background: mode.color }">{{ mode.icon }}</div>
				<div class="mode-body">
					<h2 class="mode-name" :style="{ color: mode.color }">{{ mode.name }}</h2>
					<p class="mode-desc">{{ mode.desc }}</p>
				</div>
			</div>
		</div>

		<div class="callout">
			<strong>Nemesis Blind:</strong> A PvP blind where you compete directly against your opponent. Both players play the blind simultaneously — the lower scorer loses a life. The host configures how many lives each player starts with.
		</div>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 { font-size: 22px; color: var(--bal-white); text-shadow: 3px 3px 0 rgba(0,0,0,0.4); margin-bottom: 12px; }
.doc-lead { font-size: 10px; color: var(--bal-teal-gray); line-height: 2.2; margin-bottom: 32px; }

.modes-list { display: flex; flex-direction: column; gap: 14px; margin-bottom: 28px; }

.mode-card {
	display: flex;
	align-items: flex-start;
	gap: 20px;
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-dark);
	border-radius: 14px;
	padding: 20px;
	transition: border-color 0.15s;
}
.mode-card:hover { border-color: var(--accent); }

.mode-icon {
	width: 48px; height: 48px; border-radius: 12px;
	display: flex; align-items: center; justify-content: center;
	font-size: 22px; flex-shrink: 0;
	box-shadow: 0 3px 0 rgba(0,0,0,0.3);
}

.mode-name { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.mode-desc { font-size: 10px; color: var(--bal-gray-blue); line-height: 2.2; }

.callout {
	background: rgba(0,156,253,0.08);
	border-left: 3px solid var(--bal-blue);
	border-radius: 0 10px 10px 0;
	padding: 14px 16px;
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 2;
}
.callout strong { color: var(--bal-cream); }
</style>
