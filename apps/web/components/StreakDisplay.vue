<script setup lang="ts">
const props = defineProps<{ value: number }>()
const isPos = computed(() => props.value > 0)
</script>

<template>
	<span class="streak" :class="isPos ? 'streak--pos' : 'streak--neg'">
		{{ isPos ? '↑' : '↓' }} {{ Math.abs(value) }}
	</span>
</template>

<style scoped>
.streak {
	font-size: 9px;
	font-weight: 700;
}

.streak--pos { color: var(--bal-green); }
.streak--neg { color: var(--bal-coral); }
</style>
