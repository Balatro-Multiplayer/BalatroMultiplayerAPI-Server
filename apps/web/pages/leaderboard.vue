<script setup lang="ts">
import type { LeaderboardEntry } from '~/components/LeaderboardTable.vue'

const config = useRuntimeConfig()

const MOD_ID = 'MultiplayerSpeedrunning'

const TABS = [
	{ label: 'Gold Stake', gameMode: 'ranked:spdrn_gold_stake_single' },
	{ label: 'White Stake', gameMode: 'ranked:spdrn_white_stake_triple' },
]

const activeTab = ref(TABS[0])
const search = ref('')
const sortCol = ref('rating')
const sortDir = ref<'asc' | 'desc'>('desc')

interface ApiResponse { entries: LeaderboardEntry[] }

const { data: apiData, pending, error, refresh } = await useFetch<ApiResponse>(
	() => `${config.public.apiBase}/stats/leaderboard?modId=${encodeURIComponent(MOD_ID)}&gameMode=${encodeURIComponent(activeTab.value.gameMode)}`,
	{ server: false },
)

watch(activeTab, () => refresh())

const players = computed<LeaderboardEntry[]>(() => {
	let list = apiData.value?.entries ?? []

	if (search.value) {
		const q = search.value.toLowerCase()
		list = list.filter(p => p.displayName.toLowerCase().includes(q))
	}

	return [...list].sort((a, b) => {
		const dir = sortDir.value === 'asc' ? 1 : -1
		if (sortCol.value === 'winRate') {
			const ar = a.wins / (a.gamesPlayed || 1)
			const br = b.wins / (b.gamesPlayed || 1)
			return (ar - br) * dir
		}
		if (sortCol.value === 'name') return a.displayName.localeCompare(b.displayName) * dir
		const aVal = (a as Record<string, unknown>)[sortCol.value] as number ?? 0
		const bVal = (b as Record<string, unknown>)[sortCol.value] as number ?? 0
		return (aVal - bVal) * dir
	})
})

function handleSort(col: string) {
	if (sortCol.value === col) {
		sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
	} else {
		sortCol.value = col
		sortDir.value = 'desc'
	}
}
</script>

<template>
	<div>
		<h1 class="page-title">Leaderboards</h1>

		<!-- Tab + search row -->
		<div class="controls">
			<div class="tabs">
				<BBtn
					v-for="tab in TABS"
					:key="tab.gameMode"
					:color="activeTab.gameMode === tab.gameMode ? 'coral' : 'dark'"
					size="sm"
					:depth="activeTab.gameMode === tab.gameMode ? 'high' : 'medium'"
					class="tab-btn"
					@click="activeTab = tab"
				>
					{{ tab.label }}
				</BBtn>
			</div>
			<div class="search-wrap">
				<input
					v-model="search"
					type="text"
					placeholder="Search players..."
					class="search-input"
				/>
			</div>
		</div>

		<!-- States -->
		<div v-if="pending" class="state-msg">Loading...</div>
		<div v-else-if="error" class="state-msg state-msg--error">Failed to load leaderboard.</div>
		<LeaderboardTable
			v-else
			:players="players"
			:sort-col="sortCol"
			:sort-dir="sortDir"
			@sort="handleSort"
		/>
	</div>
</template>

<style scoped>
.page-title {
	font-size: 22px;
	color: var(--bal-white);
	text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
	text-align: center;
	margin-bottom: 24px;
}

.controls {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 20px;
	flex-wrap: wrap;
}

.tabs {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
}

.tab-btn {
	font-size: 9px !important;
}

.search-wrap { margin-left: auto; }

.search-input {
	background: var(--bal-panel-dark);
	border: 3px solid var(--bal-panel);
	border-radius: 999px;
	padding: 8px 18px;
	color: var(--bal-white);
	font-family: inherit;
	font-size: 11px;
	outline: none;
	box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
	width: 240px;
}

.search-input:focus { border-color: var(--bal-blue); }

.state-msg {
	text-align: center;
	padding: 60px;
	color: var(--bal-teal-gray);
	font-size: 13px;
}

.state-msg--error { color: var(--bal-coral); }
</style>
