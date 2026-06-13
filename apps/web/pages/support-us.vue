<template>
	<div class="support-page">
		<div class="page-header">
			<h1 class="page-title">Support Us</h1>
			<p class="page-sub">Your support helps us continue developing and maintaining Balatro Multiplayer</p>
		</div>

		<div class="cards-grid">
			<!-- Mod support -->
			<BPanel variant="default" class="support-card">
				<div class="card-icon" style="background: var(--bal-amber)">☕</div>
				<div class="card-body">
					<h2 class="card-title">Support the Multiplayer Mod</h2>
					<p class="card-desc">Help fund the development of the Balatro Multiplayer Mod.</p>
					<p class="card-detail">Your contribution helps add new features, fix bugs, and maintain the multiplayer experience for everyone.</p>
				</div>
				<a href="https://ko-fi.com/virtualized/shop" target="_blank" rel="noopener noreferrer" class="support-btn">
					Support on Ko-fi ↗
				</a>
			</BPanel>

			<!-- Website support -->
			<BPanel variant="default" class="support-card">
				<div class="card-icon" style="background: var(--bal-coral)">♥</div>
				<div class="card-body">
					<h2 class="card-title">Support This Website</h2>
					<p class="card-desc">Help fund the development and hosting of this website.</p>
					<p class="card-detail">Your contribution helps improve the website, add new features, and keep the servers running smoothly.</p>
				</div>
				<div class="support-btn-group">
					<a href="https://ko-fi.com/andy_balatro" target="_blank" rel="noopener noreferrer" class="support-btn">
						Support Andy on Ko-fi ↗
					</a>
					<a href="https://ko-fi.com/jeffdev" target="_blank" rel="noopener noreferrer" class="support-btn support-btn--secondary">
						Support Jeffdev on Ko-fi ↗
					</a>
				</div>
			</BPanel>

			<!-- Bot support -->
			<BPanel variant="default" class="support-card">
				<div class="card-icon" style="background: var(--bal-purple)">🤖</div>
				<div class="card-body">
					<h2 class="card-title">Support the Discord Bot</h2>
					<p class="card-desc">Help fund the development of the Botlatro Discord bot.</p>
					<p class="card-detail">Your contribution supports the developers maintaining and improving Botlatro, the bot used for the matchmaking queue on Discord.</p>
				</div>
				<a href="https://ko-fi.com/botlatro" target="_blank" rel="noopener noreferrer" class="support-btn">
					Support on Ko-fi ↗
				</a>
			</BPanel>
		</div>

		<!-- Why it matters -->
		<BPanel variant="dark" class="why-panel">
			<div class="why-icon">$</div>
			<h2 class="why-title">Why Your Support Matters</h2>
			<p class="why-body">
				Balatro Multiplayer is a community-driven project maintained by volunteers.
				Your support directly contributes to server costs, development time, and the continued
				improvement of the multiplayer experience for all players.
			</p>
		</BPanel>
	</div>
</template>

<style scoped>
.support-page {
	max-width: 900px;
	margin: 0 auto;
}

.page-header {
	text-align: center;
	margin-bottom: 40px;
}

.page-title {
	font-size: 24px;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	margin-bottom: 12px;
}

.page-sub {
	font-size: 11px;
	color: var(--bal-teal-gray);
	line-height: 2;
}

.cards-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
	margin-bottom: 24px;
}

.support-card {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.card-icon {
	width: 48px;
	height: 48px;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
	box-shadow: 0 3px 0 rgba(0,0,0,0.3);
	flex-shrink: 0;
}

.card-body {
	flex: 1;
}

.card-title {
	font-size: 13px;
	color: var(--bal-cream);
	margin-bottom: 8px;
	font-weight: 700;
}

.card-desc {
	font-size: 9px;
	color: var(--bal-teal-gray);
	margin-bottom: 8px;
	line-height: 2;
}

.card-detail {
	font-size: 9px;
	color: var(--bal-gray-blue);
	line-height: 2;
}

.support-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	background: var(--bal-coral);
	color: var(--bal-white);
	font-family: inherit;
	font-size: 11px;
	font-weight: 700;
	padding: 10px 20px;
	border-radius: 999px;
	border: none;
	cursor: pointer;
	box-shadow: 0 4px 0 var(--bal-red-dark), 0 6px 12px rgba(0,0,0,0.3);
	transition: transform 0.1s;
	text-decoration: none;
}

.support-btn:hover { color: var(--bal-white); transform: translateY(-2px); }
.support-btn:active { transform: translateY(2px); }

.support-btn--secondary {
	background: var(--bal-panel-light);
	color: var(--bal-gray-blue);
	box-shadow: 0 4px 0 var(--bal-panel-dark), 0 6px 12px rgba(0,0,0,0.3);
}

.support-btn-group {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.why-panel {
	text-align: center;
	padding: 36px !important;
}

.why-icon {
	width: 48px;
	height: 48px;
	border-radius: 50%;
	background: var(--bal-gold);
	box-shadow: 0 3px 0 var(--bal-gold-dark);
	color: var(--bal-panel-dark);
	font-size: 22px;
	font-weight: 900;
	display: flex;
	align-items: center;
	justify-content: center;
	margin: 0 auto 20px;
}

.why-title {
	font-size: 16px;
	color: var(--bal-white);
	margin-bottom: 16px;
	text-shadow: 2px 2px 0 rgba(0,0,0,0.3);
}

.why-body {
	font-size: 10px;
	color: var(--bal-teal-gray);
	max-width: 560px;
	margin: 0 auto;
	line-height: 2.2;
}

@media (max-width: 700px) {
	.cards-grid { grid-template-columns: 1fr; }
}
</style>
