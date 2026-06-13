<script setup lang="ts">
defineProps<{
	variant?: 'default' | 'light' | 'dark'
}>()
</script>

<template>
	<div class="bpanel" :class="`bpanel--${variant ?? 'default'}`">
		<slot />
	</div>
</template>

<style scoped>
.bpanel {
	border-radius: 16px;
	padding: 24px;
}

.bpanel--default {
	background: var(--bal-panel);
	border: 3px solid var(--bal-panel-dark);
	box-shadow: inset 0 2px 6px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.4);
}

.bpanel--light {
	background: var(--bal-panel-light);
	border: 3px solid var(--bal-panel);
	box-shadow: inset 0 2px 4px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.3);
}

.bpanel--dark {
	background: var(--bal-panel-dark);
	border: 3px solid rgba(0,0,0,0.3);
	box-shadow: inset 0 2px 6px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.5);
}
</style>
