<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const ranks = [
	{ name: 'Stone', req: 'Under 250 MMR', color: '#bcbcbc', icon: '🪨' },
	{ name: 'Steel', req: '250 MMR+', color: '#a0c5c3', icon: '⚙' },
	{ name: 'Gold', req: '320 MMR+', color: '#fdcf51', icon: '⭐' },
	{ name: 'Lucky', req: '460 MMR+', color: '#56a786', icon: '🍀' },
	{ name: 'Glass', req: '620 MMR+', color: '#83e9f8', icon: '💎' },
	{ name: 'Foil', req: 'Top 50 players', color: '#9879cb', icon: '✨' },
	{ name: 'Holographic', req: 'Top 10 players', color: '#3cb4ff', icon: '🌈' },
	{ name: 'Polychrome', req: 'Top 5 players', color: '#fda0a5', icon: '🔮' },
	{ name: 'Negative', req: 'Top 1 player', color: '#f4f8f9', icon: '⬛' },
]
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Ranked Matchmaking</h1>
		<p class="doc-lead">How to compete in ranked matches and climb the global leaderboards.</p>

		<section class="doc-section">
			<h2 class="doc-h2">Ranked Queue</h2>
			<p class="doc-p">
				The <strong class="hl">Ranked Queue</strong> is the default competitive queue in Balatro Multiplayer.
				Players compete against each other in a rating-based matchmaking system.
			</p>
			<p class="doc-p">
				One of the main differentiators is that the Ranked Queue
				<strong class="hl">includes changes to base game balance</strong> designed to make the game
				<strong class="hl">less RNG-heavy and more competitive</strong>.
				See <NuxtLink to="/docs/rulesets/standard" class="doc-link">Standard Ranked ruleset</NuxtLink> for details.
			</p>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Other Queues</h2>
			<div class="queue-grid">
				<div class="queue-card">
					<h3 class="queue-title">Smallworld</h3>
					<p class="queue-desc">Only 25% of everything at your disposal, and Showman is ALWAYS active. A fundamentally different deckbuilding challenge.</p>
				</div>
				<div class="queue-card">
					<h3 class="queue-title">Vanilla</h3>
					<p class="queue-desc">Original game balance with no special changes besides shared seed. Pure Balatro, competitive format.</p>
				</div>
			</div>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Starting MMR &amp; Ranks</h2>
			<p class="doc-p">All players start at <strong class="hl">200 MMR</strong>. Ranks are determined by your current rating.</p>

			<div class="ranks-list">
				<div
					v-for="rank in ranks"
					:key="rank.name"
					class="rank-row"
				>
					<div class="rank-icon" :style="{ background: rank.color }">{{ rank.icon }}</div>
					<div class="rank-info">
						<span class="rank-name" :style="{ color: rank.color }">{{ rank.name }}</span>
						<span class="rank-req">{{ rank.req }}</span>
					</div>
				</div>
			</div>
		</section>

		<section class="doc-section">
			<p class="doc-p">
				Check your MMR or leaderboard position on the
				<NuxtLink to="/leaderboard" class="doc-link">Leaderboards page</NuxtLink>.
			</p>
		</section>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 { font-size: 22px; color: var(--bal-white); text-shadow: 3px 3px 0 rgba(0,0,0,0.4); margin-bottom: 12px; }
.doc-h2 { font-size: 15px; color: var(--bal-cream); margin-bottom: 14px; font-weight: 700; }
.doc-lead { font-size: 10px; color: var(--bal-teal-gray); line-height: 2.2; margin-bottom: 32px; }
.doc-p { font-size: 10px; color: var(--bal-gray-blue); line-height: 2.2; margin-bottom: 12px; }
.doc-section { margin-bottom: 40px; }
.doc-link { color: var(--bal-blue); }
.hl { color: var(--bal-cream); }

.queue-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
.queue-card {
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-dark);
	border-radius: 12px;
	padding: 16px;
}
.queue-title { font-size: 12px; color: var(--bal-cream); margin-bottom: 8px; }
.queue-desc { font-size: 9px; color: var(--bal-teal-gray); line-height: 2; }

.ranks-list { display: flex; flex-direction: column; gap: 8px; }
.rank-row {
	display: flex; align-items: center; gap: 14px;
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-dark);
	border-radius: 10px;
	padding: 10px 16px;
}
.rank-icon {
	width: 36px; height: 36px; border-radius: 8px;
	display: flex; align-items: center; justify-content: center;
	font-size: 16px; flex-shrink: 0;
	box-shadow: 0 2px 0 rgba(0,0,0,0.3);
}
.rank-info { display: flex; align-items: baseline; gap: 12px; }
.rank-name { font-size: 12px; font-weight: 700; }
.rank-req { font-size: 9px; color: var(--bal-gray-mid); }

@media (max-width: 500px) { .queue-grid { grid-template-columns: 1fr; } }
</style>
