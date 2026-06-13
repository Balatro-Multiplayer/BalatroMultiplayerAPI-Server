<script setup lang="ts">
export interface LeaderboardEntry {
	rank: number
	playerId: string
	displayName: string
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
}

const props = defineProps<{
	players: LeaderboardEntry[]
	sortCol: string
	sortDir: 'asc' | 'desc'
}>()

const emit = defineEmits<{
	sort: [col: string]
}>()

const columns = [
	{ key: 'rank',      label: '#' },
	{ key: 'name',      label: 'Player' },
	{ key: 'rating',    label: 'MMR' },
	{ key: 'winRate',   label: 'Win %' },
	{ key: 'wins',      label: 'Wins' },
	{ key: 'losses',    label: 'Losses' },
	{ key: 'gamesPlayed', label: 'Games' },
]
</script>

<template>
	<div class="lb-wrap">
		<!-- Header -->
		<div class="lb-header">
			<div
				v-for="col in columns"
				:key="col.key"
				class="lb-th"
				@click="emit('sort', col.key)"
			>
				{{ col.label }}
				<span v-if="sortCol === col.key" class="sort-arrow">
					{{ sortDir === 'asc' ? '▲' : '▼' }}
				</span>
			</div>
		</div>

		<!-- Rows -->
		<div
			v-for="(p, i) in players"
			:key="p.playerId"
			class="lb-row"
			:class="{ 'lb-row--alt': i % 2 === 0 }"
		>
			<div class="lb-cell lb-cell--rank">
				<RankBadge :rank="p.rank" />
			</div>

			<div class="lb-cell lb-cell--name">
				<div class="player-avatar">👤</div>
				<span class="player-name" :class="{ 'player-name--top3': p.rank <= 3 }">
					{{ p.displayName }}
				</span>
			</div>

			<div class="lb-cell lb-cell--mmr">{{ p.rating.toLocaleString() }}</div>
			<div class="lb-cell">
				<WinRateBadge :wins="p.wins" :losses="p.losses" />
			</div>
			<div class="lb-cell lb-cell--wins">{{ p.wins }}</div>
			<div class="lb-cell lb-cell--losses">{{ p.losses }}</div>
			<div class="lb-cell lb-cell--games">{{ p.gamesPlayed }}</div>
		</div>

		<div v-if="players.length === 0" class="lb-empty">
			No players found
		</div>
	</div>
</template>

<style scoped>
.lb-wrap {
	background: var(--bal-panel);
	border: 3px solid var(--bal-panel-dark);
	box-shadow: inset 0 2px 6px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.4);
	border-radius: 18px;
	overflow: hidden;
}

.lb-header,
.lb-row {
	display: grid;
	grid-template-columns: 56px 1fr 90px 72px 64px 64px 64px;
	align-items: center;
	padding: 0 12px;
}

.lb-header {
	background: var(--bal-panel-dark);
	border-bottom: 3px solid var(--bal-panel);
}

.lb-th {
	padding: 12px 8px;
	font-size: 9px;
	color: var(--bal-gray-blue);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	cursor: pointer;
	user-select: none;
	white-space: nowrap;
}

.lb-th:hover { color: var(--bal-white); }

.sort-arrow { color: var(--bal-coral); margin-left: 4px; }

.lb-row {
	min-height: 48px;
	border-bottom: 1px solid rgba(0,0,0,0.15);
	transition: background 0.1s;
}

.lb-row--alt { background: rgba(0,0,0,0.1); }
.lb-row:hover { background: rgba(253,95,85,0.08) !important; }

.lb-cell {
	padding: 8px;
	font-size: 9px;
}

.lb-cell--rank { display: flex; align-items: center; }

.lb-cell--name {
	display: flex;
	align-items: center;
	gap: 8px;
	overflow: hidden;
}

.player-avatar {
	width: 28px;
	height: 28px;
	border-radius: 6px;
	background: var(--bal-panel-dark);
	border: 2px solid var(--bal-panel-light);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	color: var(--bal-gray-mid);
	flex-shrink: 0;
}

.player-name {
	color: var(--bal-white);
	font-size: 9px;
	font-weight: 700;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.player-name--top3 { color: var(--bal-cream); }

.lb-cell--mmr   { color: var(--bal-blue);     font-weight: 700; font-size: 10px; }
.lb-cell--wins  { color: var(--bal-green);    font-weight: 700; }
.lb-cell--losses{ color: var(--bal-coral); }
.lb-cell--games { color: var(--bal-gray-blue); }

.lb-empty {
	padding: 48px;
	text-align: center;
	color: var(--bal-gray-mid);
	font-size: 11px;
}
</style>
