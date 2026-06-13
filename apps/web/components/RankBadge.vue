<script setup lang="ts">
const props = defineProps<{ rank: number }>()
const isTop3 = computed(() => props.rank <= 3)
</script>

<template>
	<div class="rank-badge" :class="{ 'rank-badge--top3': isTop3, [`rank-badge--${rank}`]: rank <= 3 }">
		{{ rank }}
	</div>
</template>

<style scoped>
.rank-badge {
	width: 30px;
	height: 30px;
	border-radius: 8px;
	background: var(--bal-panel);
	box-shadow: 0 2px 0 var(--bal-panel-dark);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	font-weight: 700;
	color: var(--bal-gray-blue);
	flex-shrink: 0;
}

.rank-badge--top3 {
	width: 36px;
	height: 36px;
	border-radius: 10px;
	font-size: 13px;
	color: #fff;
}

.rank-badge--1 { background: var(--bal-gold);    box-shadow: 0 3px 0 var(--bal-gold-dark),    0 4px 8px rgba(0,0,0,0.3); }
.rank-badge--2 { background: var(--bal-gray);    box-shadow: 0 3px 0 #888,                    0 4px 8px rgba(0,0,0,0.3); }
.rank-badge--3 { background: #cd7f32;            box-shadow: 0 3px 0 #8b5a2b,                 0 4px 8px rgba(0,0,0,0.3); }
</style>
