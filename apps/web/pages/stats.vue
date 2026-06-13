<script setup lang="ts">
const config = useRuntimeConfig()

const MOD_ID = 'MultiplayerSpeedrunning'
const GAME_MODE = 'ranked:spdrn_gold_stake_single'

const { data: stats } = await useFetch<{ activePlayers: number; totalMatches: number; uniquePlayers: number }>(
	`${config.public.apiBase}/stats`,
	{ server: false },
)

const { data: lbData } = await useFetch<{ entries: Array<{
	rank: number; playerId: string; displayName: string
	rating: number; wins: number; losses: number; gamesPlayed: number
}>}>(
	`${config.public.apiBase}/stats/leaderboard?modId=${encodeURIComponent(MOD_ID)}&gameMode=${encodeURIComponent(GAME_MODE)}`,
	{ server: false },
)

const top10 = computed(() => (lbData.value?.entries ?? []).slice(0, 10))

const ratingBands = computed(() => {
	const entries = lbData.value?.entries ?? []
	if (!entries.length) return []
	const bands = [
		{ label: 'Stone\n(<250)', min: 0, max: 249, color: 'var(--bal-gray)' },
		{ label: 'Steel\n(250+)', min: 250, max: 319, color: 'var(--bal-teal-gray)' },
		{ label: 'Gold\n(320+)', min: 320, max: 459, color: 'var(--bal-gold)' },
		{ label: 'Lucky\n(460+)', min: 460, max: 619, color: 'var(--bal-green)' },
		{ label: 'Glass\n(620+)', min: 620, max: 9999, color: 'var(--bal-blue)' },
	]
	return bands.map(b => ({
		...b,
		count: entries.filter(e => e.rating >= b.min && e.rating <= b.max).length,
	}))
})

const maxBandCount = computed(() => Math.max(...ratingBands.value.map(b => b.count), 1))

const winRateDistribution = computed(() => {
	const entries = lbData.value?.entries ?? []
	if (!entries.length) return []
	const buckets = [
		{ label: '0–20%', min: 0, max: 20 },
		{ label: '20–40%', min: 20, max: 40 },
		{ label: '40–60%', min: 40, max: 60 },
		{ label: '60–80%', min: 60, max: 80 },
		{ label: '80–100%', min: 80, max: 100 },
	]
	return buckets.map(b => {
		const count = entries.filter(e => {
			const g = e.wins + e.losses
			const wr = g > 0 ? (e.wins / g) * 100 : 0
			return wr >= b.min && wr < b.max
		}).length
		return { ...b, count }
	})
})

const maxWrCount = computed(() => Math.max(...winRateDistribution.value.map(b => b.count), 1))

const avgWinRate = computed(() => {
	const entries = lbData.value?.entries ?? []
	if (!entries.length) return null
	const total = entries.reduce((sum, e) => {
		const g = e.wins + e.losses
		return sum + (g > 0 ? e.wins / g : 0)
	}, 0)
	return Math.round((total / entries.length) * 100)
})

const totalGames = computed(() => (lbData.value?.entries ?? []).reduce((s, e) => s + e.gamesPlayed, 0))
</script>

<template>
	<div class="stats-page">
		<div class="page-header">
			<h1 class="page-title">Stats</h1>
			<p class="page-sub">Global Balatro Multiplayer statistics</p>
		</div>

		<!-- Global counters -->
		<div class="global-row">
			<BPanel variant="default" class="global-cell">
				<div class="global-value" style="color: var(--bal-blue)">
					{{ stats?.totalMatches?.toLocaleString() ?? '—' }}
				</div>
				<div class="global-label">Total Matches</div>
			</BPanel>
			<BPanel variant="default" class="global-cell">
				<div class="global-value" style="color: var(--bal-green)">
					{{ totalGames?.toLocaleString() || stats?.activePlayers?.toLocaleString() || '—' }}
				</div>
				<div class="global-label">Ranked Games Played</div>
			</BPanel>
			<BPanel variant="default" class="global-cell">
				<div class="global-value" style="color: var(--bal-coral)">
					{{ stats?.uniquePlayers?.toLocaleString() ?? '—' }}
				</div>
				<div class="global-label">Unique Players</div>
			</BPanel>
			<BPanel variant="default" class="global-cell">
				<div class="global-value" style="color: var(--bal-gold)">
					{{ lbData?.entries?.length?.toLocaleString() ?? '—' }}
				</div>
				<div class="global-label">Ranked Players</div>
			</BPanel>
		</div>

		<div class="charts-grid">
			<!-- Rating distribution -->
			<BPanel variant="default" class="chart-panel">
				<h2 class="chart-title">Rating Distribution</h2>
				<p class="chart-sub">Players per rank tier</p>
				<div class="bar-chart">
					<div
						v-for="band in ratingBands"
						:key="band.label"
						class="bar-col"
					>
						<div class="bar-count">{{ band.count }}</div>
						<div
							class="bar-fill"
							:style="{
								height: `${Math.max(4, (band.count / maxBandCount) * 120)}px`,
								background: band.color,
							}"
						/>
						<div class="bar-label" style="white-space: pre-line">{{ band.label }}</div>
					</div>
				</div>
			</BPanel>

			<!-- Win rate distribution -->
			<BPanel variant="default" class="chart-panel">
				<h2 class="chart-title">Win Rate Distribution</h2>
				<p class="chart-sub">Avg win rate: {{ avgWinRate !== null ? avgWinRate + '%' : '—' }}</p>
				<div class="bar-chart">
					<div
						v-for="bucket in winRateDistribution"
						:key="bucket.label"
						class="bar-col"
					>
						<div class="bar-count">{{ bucket.count }}</div>
						<div
							class="bar-fill"
							:style="{
								height: `${Math.max(4, (bucket.count / maxWrCount) * 120)}px`,
								background: 'var(--bal-coral)',
							}"
						/>
						<div class="bar-label">{{ bucket.label }}</div>
					</div>
				</div>
			</BPanel>
		</div>

		<!-- Top 10 leaderboard -->
		<BPanel variant="default" class="top10-panel">
			<h2 class="chart-title">Top 10 Players — Gold Stake</h2>
			<p class="chart-sub">Current season leaderboard leaders</p>
			<div v-if="top10.length === 0" class="empty">Loading...</div>
			<div v-else class="top10-list">
				<div
					v-for="p in top10"
					:key="p.playerId"
					class="top10-row"
					:class="{ 'top10-row--podium': p.rank <= 3 }"
				>
					<RankBadge :rank="p.rank" />
					<span class="top10-name">{{ p.displayName }}</span>
					<span class="top10-mmr">{{ p.rating.toLocaleString() }}</span>
					<WinRateBadge :wins="p.wins" :losses="p.losses" />
					<span class="top10-games">{{ p.gamesPlayed }}g</span>
				</div>
			</div>
		</BPanel>

		<!-- Seasons notice -->
		<BPanel variant="dark" class="notice-panel">
			<p class="notice-text">
				More stats including deck popularity, game activity charts, and head-to-head records are coming soon.
				<NuxtLink to="/leaderboard" class="notice-link">View full leaderboard →</NuxtLink>
			</p>
		</BPanel>
	</div>
</template>

<style scoped>
.stats-page {
	max-width: 900px;
	margin: 0 auto;
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.page-header { text-align: center; }

.page-title {
	font-size: 24px;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	margin-bottom: 8px;
}

.page-sub {
	font-size: 9px;
	color: var(--bal-teal-gray);
	text-transform: uppercase;
	letter-spacing: 0.1em;
}

.global-row {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 12px;
}

.global-cell {
	text-align: center;
	padding: 20px 12px !important;
}

.global-value {
	font-size: 22px;
	font-weight: 900;
	margin-bottom: 8px;
}

.global-label {
	font-size: 8px;
	color: var(--bal-gray-blue);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.charts-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}

.chart-panel { padding: 24px !important; }

.chart-title {
	font-size: 13px;
	color: var(--bal-cream);
	margin-bottom: 4px;
	font-weight: 700;
}

.chart-sub {
	font-size: 9px;
	color: var(--bal-teal-gray);
	margin-bottom: 20px;
}

.bar-chart {
	display: flex;
	align-items: flex-end;
	gap: 8px;
	height: 160px;
	padding-bottom: 28px;
	position: relative;
}

.bar-col {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: flex-end;
	gap: 4px;
	height: 100%;
	position: relative;
}

.bar-count {
	font-size: 9px;
	color: var(--bal-gray-blue);
	font-weight: 700;
	position: absolute;
	top: 0;
}

.bar-fill {
	width: 100%;
	border-radius: 6px 6px 0 0;
	box-shadow: 0 -2px 6px rgba(0,0,0,0.2);
	transition: height 0.4s ease;
}

.bar-label {
	position: absolute;
	bottom: -4px;
	font-size: 7px;
	color: var(--bal-gray-mid);
	text-align: center;
	line-height: 1.4;
}

.top10-panel { padding: 24px !important; }

.top10-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-top: 12px;
}

.top10-row {
	display: grid;
	grid-template-columns: 40px 1fr 80px 72px 48px;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	border-radius: 10px;
	background: rgba(0,0,0,0.1);
}

.top10-row--podium { background: rgba(253,207,81,0.06); }

.top10-name {
	font-size: 10px;
	color: var(--bal-white);
	font-weight: 700;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.top10-mmr {
	color: var(--bal-blue);
	font-size: 10px;
	font-weight: 700;
	text-align: right;
}

.top10-games {
	color: var(--bal-gray-mid);
	font-size: 8px;
	text-align: right;
}

.notice-panel { text-align: center; }

.notice-text {
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 2;
}

.notice-link {
	color: var(--bal-blue);
	margin-left: 4px;
}

.empty {
	color: var(--bal-gray-mid);
	font-size: 11px;
	padding: 24px;
	text-align: center;
}

@media (max-width: 700px) {
	.global-row { grid-template-columns: repeat(2, 1fr); }
	.charts-grid { grid-template-columns: 1fr; }
	.top10-row { grid-template-columns: 40px 1fr 80px; }
	.top10-row > :nth-child(4),
	.top10-row > :nth-child(5) { display: none; }
}
</style>
