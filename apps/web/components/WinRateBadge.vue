<script setup lang="ts">
const props = defineProps<{ wins: number; losses: number }>()
const pct = computed(() => {
	const games = props.wins + props.losses
	return games > 0 ? Math.round((props.wins / games) * 100) : 0
})
const colorClass = computed(() => pct.value >= 70 ? 'wr--green' : pct.value >= 60 ? 'wr--amber' : 'wr--coral')
</script>

<template>
	<span class="wr" :class="colorClass">{{ pct }}%</span>
</template>

<style scoped>
.wr {
	display: inline-block;
	padding: 4px 10px;
	border-radius: 999px;
	color: #fff;
	font-size: 9px;
	font-weight: 700;
}

.wr--green { background: var(--bal-green);  box-shadow: 0 2px 0 var(--bal-green-dark); }
.wr--amber { background: var(--bal-amber);  box-shadow: 0 2px 0 var(--bal-amber-dark); }
.wr--coral { background: var(--bal-coral);  box-shadow: 0 2px 0 var(--bal-red-dark); }
</style>
