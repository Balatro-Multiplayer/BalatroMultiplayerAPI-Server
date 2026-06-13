<script setup lang="ts">
const config = useRuntimeConfig()

const { data: stats } = await useFetch<{ activePlayers: number; totalMatches: number; uniquePlayers: number }>(
	`${config.public.apiBase}/stats`,
	{ server: false }
)

const statsDisplay = computed(() => [
	{ label: 'Total Matches', value: stats.value?.totalMatches.toLocaleString() ?? '...', color: 'var(--bal-blue)' },
	{ label: 'Active Players', value: stats.value?.activePlayers.toLocaleString() ?? '...', color: 'var(--bal-green)' },
	{ label: 'Unique Players', value: stats.value?.uniquePlayers.toLocaleString() ?? '...', color: 'var(--bal-coral)' },
])

const features = [
	{ title: 'Real-time Matches', desc: 'Challenge friends to head-to-head Balatro matches in real time.', color: 'var(--bal-coral)', icon: '⚔' },
	{ title: 'Global Leaderboards', desc: 'Compete for the highest scores and track your progress against players worldwide.', color: 'var(--bal-blue)', icon: '🏆' },
	{ title: 'Custom Game Modes', desc: 'Play with modified rules and unique challenges created by the community.', color: 'var(--bal-amber)', icon: '⚙' },
	{ title: 'Ranked Matchmaking', desc: 'Join MMR-based queues — Ranked, Smallworld, and Vanilla — and climb the ladder.', color: 'var(--bal-purple)', icon: '★' },
	{ title: 'Active Community', desc: 'Join our Discord to find matches, share strategies, and join tournaments.', color: 'var(--bal-green)', icon: '♣' },
	{ title: 'Cross-Platform', desc: 'Play with friends on Windows, Mac, or Linux — no platform barriers.', color: 'var(--bal-teal-gray)', icon: '🖥' },
]

const waysToPlay = [
	{
		title: 'Direct Play',
		icon: '♣',
		color: 'var(--bal-coral)',
		desc: 'Challenge friends in private matches',
		bullets: ['No matchmaking or ratings', 'Customize all lobby options', 'Play with friends directly', 'Perfect for casual games'],
	},
	{
		title: 'Matchmaking Queues',
		icon: '★',
		color: 'var(--bal-blue)',
		desc: 'Compete in multiple queues for MMR',
		bullets: [
			'Ranked — rebalanced cards for competitive play',
			'Smallworld — 25% of everything, Showman always active',
			'Vanilla — original balance, shared seed',
		],
	},
	{
		title: 'Custom LFG',
		icon: '♦',
		color: 'var(--bal-amber)',
		desc: 'Organize custom matches with unique rules',
		bullets: ['Any ruleset or lobby options', 'Compatible with approved mods', 'No MMR or rankings', 'Great for experimenting with new formats'],
	},
]
</script>

<template>
	<div class="landing">
		<!-- Hero -->
		<section class="hero">
			<a href="https://github.com/Virtualized-DEV/BalatroMultiplayerAPI" class="github-badge" target="_blank" rel="noopener">
				<span class="star">★</span>
				<span>Follow along on GitHub</span>
			</a>

			<h1 class="hero-title">
				Play Balatro<br />Against Your Friends
			</h1>
			<p class="hero-sub">
				The unofficial multiplayer mod. Challenge friends, compete in ranked matches, climb the leaderboards.
			</p>

			<div class="hero-ctas">
				<a href="https://github.com/Virtualized-DEV/BalatroMultiplayerAPI/releases" target="_blank" rel="noopener">
					<BBtn color="blue" size="lg">Get Started &rarr;</BBtn>
				</a>
				<NuxtLink to="/leaderboard">
					<BBtn color="dark" size="lg">Leaderboard</BBtn>
				</NuxtLink>
			</div>

			<!-- Screenshot -->
			<div class="screenshot-panel">
				<div class="scanlines" aria-hidden="true" />
				<img
					src="/multiplayer-screenshot.jpeg"
					alt="Balatro Multiplayer gameplay"
					class="screenshot-img"
				/>
			</div>
		</section>

		<!-- Stats -->
		<div class="stats-row">
			<div
				v-for="s in statsDisplay"
				:key="s.label"
				class="stat-cell"
			>
				<span class="stat-value" :style="{ color: s.color }">{{ s.value }}</span>
				<span class="stat-label">{{ s.label }}</span>
			</div>
		</div>

		<!-- Officially unofficial quote -->
		<section class="quote-section">
			<p class="quote-eyebrow">Officially unofficial&trade;</p>
			<blockquote class="quote-text">&ldquo;There&rsquo;s a cool mod if you want that&rdquo;</blockquote>
			<p class="quote-attr">
				The closest thing to a blessing we&rsquo;ll ever get from localthunk, and we&rsquo;re running with it.
			</p>
			<div class="quote-img-wrap">
				<img src="/localthunk_on_multiplayer.png" alt="localthunk on Discord: no balatro multiplayer, there is a cool mod if you want that" class="quote-img" />
			</div>
		</section>

		<!-- Features grid -->
		<section class="section section--features">
			<h2 class="section-title">Features</h2>
			<p class="section-sub">Play with friends, compete globally, join tournaments</p>
			<div class="features">
				<BPanel
					v-for="f in features"
					:key="f.title"
					variant="default"
					class="feature-card"
				>
					<div class="feature-icon" :style="{ background: f.color }">{{ f.icon }}</div>
					<h3 class="feature-title">{{ f.title }}</h3>
					<p class="feature-desc">{{ f.desc }}</p>
				</BPanel>
			</div>
		</section>

		<!-- Ways to play -->
		<section class="section section--ways">
			<h2 class="section-title">Ways to Play</h2>
			<p class="section-sub">Choose how you want to experience Balatro Multiplayer</p>
			<div class="ways-grid">
				<BPanel
					v-for="w in waysToPlay"
					:key="w.title"
					variant="default"
					class="way-card"
				>
					<div class="way-icon" :style="{ background: w.color }">{{ w.icon }}</div>
					<h3 class="way-title">{{ w.title }}</h3>
					<p class="way-desc">{{ w.desc }}</p>
					<ul class="way-bullets">
						<li v-for="b in w.bullets" :key="b">{{ b }}</li>
					</ul>
				</BPanel>
			</div>
			<div class="ways-ctas">
				<NuxtLink to="/leaderboard">
					<BBtn color="blue" size="md">View Leaderboards 🏆</BBtn>
				</NuxtLink>
				<a href="https://discord.gg/bBb5eU2gWc" target="_blank" rel="noopener">
					<BBtn color="dark" size="md">Join Our Discord ↗</BBtn>
				</a>
			</div>
		</section>

		<!-- How it works -->
		<section class="section section--how">
			<h2 class="section-title">How It Works</h2>
			<p class="section-sub">Getting started is simple — install the mod, connect with friends, and play</p>
			<div class="how-grid">
				<div class="how-steps">
					<div class="how-step">
						<div class="how-num">1</div>
						<div>
							<h3 class="how-step-title">Install the Mod</h3>
							<p class="how-step-desc">Download and install the multiplayer mod via our official launcher or manually by following the docs.</p>
						</div>
					</div>
					<div class="how-step">
						<div class="how-num">2</div>
						<div>
							<h3 class="how-step-title">Start a Match</h3>
							<p class="how-step-desc">Host your own game or join an existing one with a simple game code.</p>
						</div>
					</div>
					<div class="how-step">
						<div class="how-num">3</div>
						<div>
							<h3 class="how-step-title">Play Together</h3>
							<p class="how-step-desc">Compete in real-time with synchronized gameplay and live scoring.</p>
						</div>
					</div>
					<NuxtLink to="/docs/getting-started/installation">
						<BBtn color="coral" size="md">Install Now</BBtn>
					</NuxtLink>
				</div>
				<div class="how-screenshot">
					<img src="/multiplayer-screenshot.jpeg" alt="Balatro Multiplayer gameplay" class="how-img" />
				</div>
			</div>
		</section>

		<!-- Final CTA -->
		<section class="cta-section">
			<h2 class="cta-title">Ready to Play?</h2>
			<p class="cta-sub">Join our competitive community of 3,000+ ranked players.</p>
			<a
				href="https://github.com/Balatro-Multiplayer/Balatro-Multiplayer-Launcher/releases"
				target="_blank"
				rel="noopener"
				class="download-cta"
			>
				<BBtn color="orange" size="lg" class="download-btn">Get Started Now</BBtn>
			</a>
		</section>
	</div>
</template>

<style scoped>
.landing {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0;
}

/* Hero */
.hero {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	padding: 48px 32px 56px;
	width: 100%;
}

.github-badge {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-light);
	box-shadow: inset 0 2px 6px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.4);
	border-radius: 999px;
	padding: 7px 20px;
	margin-bottom: 32px;
	color: var(--bal-gray-blue);
	font-size: 9px;
}

.star { color: var(--bal-gold); font-size: 14px; }

.hero-title {
	font-size: 32px;
	font-weight: 900;
	color: var(--bal-white);
	line-height: 1.9;
	margin: 0 0 24px;
	max-width: 800px;
	text-shadow: 4px 4px 0 rgba(0,0,0,0.5);
}

.hero-sub {
	font-size: 10px;
	color: var(--bal-gray-blue);
	line-height: 2.4;
	max-width: 540px;
	margin: 0 0 40px;
}

.hero-ctas {
	display: flex;
	gap: 16px;
	flex-wrap: wrap;
	justify-content: center;
	margin-bottom: 52px;
}

.screenshot-panel {
	width: 100%;
	max-width: 900px;
	border: 4px solid var(--bal-panel-dark);
	border-radius: 20px;
	position: relative;
	overflow: hidden;
	box-shadow: inset 0 2px 6px rgba(0,0,0,0.3), 0 8px 32px rgba(0,0,0,0.5);
}

.scanlines {
	position: absolute;
	inset: 0;
	opacity: 0.04;
	pointer-events: none;
	z-index: 1;
	background: repeating-linear-gradient(
		0deg,
		transparent,
		transparent 2px,
		rgba(0,0,0,0.4) 2px,
		rgba(0,0,0,0.4) 4px
	);
}

.screenshot-img {
	display: block;
	width: 100%;
	height: auto;
	image-rendering: auto;
}

/* Stats row */
.stats-row {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	width: 100%;
	max-width: 940px;
	margin-bottom: 48px;
	background: var(--bal-panel-dark);
	border: 3px solid rgba(0,0,0,0.3);
	box-shadow: inset 0 2px 6px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.5);
	border-radius: 18px;
	overflow: hidden;
}

.stat-cell {
	padding: 24px 20px;
	text-align: center;
	display: flex;
	flex-direction: column;
	gap: 10px;
	border-right: 2px solid rgba(79,99,103,0.3);
}

.stat-cell:last-child { border-right: none; }

.stat-value {
	font-size: 22px;
	font-weight: 900;
}

.stat-label {
	font-size: 7px;
	color: var(--bal-gray-blue);
	text-transform: uppercase;
	letter-spacing: 0.1em;
}

/* Features */
.features {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 14px;
	width: 100%;
	max-width: 940px;
	margin-bottom: 40px;
}

.feature-card { padding: 22px !important; }

.feature-icon {
	width: 42px;
	height: 42px;
	border-radius: 10px;
	margin-bottom: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 18px;
	box-shadow: 0 3px 0 rgba(0,0,0,0.3);
}

.feature-title {
	font-size: 11px;
	color: var(--bal-white);
	margin: 0 0 12px;
	font-weight: 700;
	line-height: 1.6;
}

.feature-desc {
	font-size: 8px;
	color: var(--bal-gray-blue);
	line-height: 2.2;
}

/* Sections */
.section {
	width: 100%;
	max-width: 940px;
	margin-bottom: 56px;
	display: flex;
	flex-direction: column;
	align-items: center;
}

.section-title {
	font-size: 22px;
	font-weight: 900;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	margin-bottom: 8px;
}

.section-sub {
	font-size: 10px;
	color: var(--bal-teal-gray);
	margin-bottom: 28px;
	text-align: center;
}

/* Quote section */
.quote-section {
	width: 100%;
	max-width: 600px;
	text-align: center;
	margin-bottom: 56px;
}

.quote-eyebrow {
	font-size: 9px;
	color: var(--bal-teal-gray);
	text-transform: uppercase;
	letter-spacing: 0.1em;
	margin-bottom: 12px;
}

.quote-text {
	font-size: 20px;
	font-weight: 900;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	margin-bottom: 16px;
	line-height: 1.6;
}

.quote-attr {
	font-size: 10px;
	color: var(--bal-gray-blue);
	line-height: 2;
	margin-bottom: 24px;
}

.quote-img-wrap {
	border-radius: 14px;
	overflow: hidden;
	border: 3px solid var(--bal-panel-dark);
	box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}

.quote-img {
	display: block;
	width: 100%;
	image-rendering: auto;
}

/* Features */
.features {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 14px;
	width: 100%;
}

.feature-card { padding: 22px !important; }

.feature-icon {
	width: 42px;
	height: 42px;
	border-radius: 10px;
	margin-bottom: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 18px;
	box-shadow: 0 3px 0 rgba(0,0,0,0.3);
}

.feature-title {
	font-size: 11px;
	color: var(--bal-white);
	margin: 0 0 12px;
	font-weight: 700;
	line-height: 1.6;
}

.feature-desc {
	font-size: 8px;
	color: var(--bal-gray-blue);
	line-height: 2.2;
}

/* Ways to play */
.ways-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
	width: 100%;
	margin-bottom: 28px;
}

.way-card {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 22px !important;
}

.way-icon {
	width: 48px;
	height: 48px;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
	box-shadow: 0 3px 0 rgba(0,0,0,0.3);
}

.way-title {
	font-size: 13px;
	color: var(--bal-white);
	font-weight: 700;
}

.way-desc {
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 2;
}

.way-bullets {
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.way-bullets li {
	font-size: 9px;
	color: var(--bal-gray-blue);
	line-height: 1.8;
	padding-left: 12px;
	position: relative;
}

.way-bullets li::before {
	content: '•';
	position: absolute;
	left: 0;
	color: var(--bal-panel-light);
}

.ways-ctas {
	display: flex;
	gap: 16px;
	flex-wrap: wrap;
	justify-content: center;
}

/* How it works */
.how-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 48px;
	width: 100%;
	align-items: center;
}

.how-steps {
	display: flex;
	flex-direction: column;
	gap: 24px;
}

.how-step {
	display: flex;
	align-items: flex-start;
	gap: 16px;
}

.how-num {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	background: var(--bal-coral);
	color: var(--bal-white);
	font-size: 13px;
	font-weight: 900;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	box-shadow: 0 3px 0 var(--bal-red-dark);
}

.how-step-title {
	font-size: 13px;
	color: var(--bal-white);
	font-weight: 700;
	margin-bottom: 6px;
}

.how-step-desc {
	font-size: 9px;
	color: var(--bal-gray-blue);
	line-height: 2;
}

.how-screenshot {
	border-radius: 16px;
	overflow: hidden;
	border: 3px solid var(--bal-panel-dark);
	box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}

.how-img {
	display: block;
	width: 100%;
	image-rendering: auto;
}

/* Final CTA */
.cta-section {
	width: 100%;
	max-width: 940px;
	background: rgba(0,0,0,0.2);
	border-radius: 20px;
	border: 3px solid rgba(0,0,0,0.2);
	padding: 48px 32px;
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	margin-bottom: 32px;
}

.cta-title {
	font-size: 24px;
	font-weight: 900;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
}

.cta-sub {
	font-size: 10px;
	color: var(--bal-teal-gray);
	line-height: 2;
}

/* CTA */
.download-cta { width: 100%; max-width: 940px; }
.download-btn { width: 100%; font-size: 14px; padding: 18px 40px !important; }

@media (max-width: 820px) {
	.how-grid { grid-template-columns: 1fr; }
	.how-screenshot { display: none; }
}

@media (max-width: 640px) {
	.features { grid-template-columns: 1fr; }
	.ways-grid { grid-template-columns: 1fr; }
	.stats-row { grid-template-columns: 1fr; }
	.stat-cell { border-right: none; border-bottom: 2px solid rgba(79,99,103,0.3); }
}
</style>
