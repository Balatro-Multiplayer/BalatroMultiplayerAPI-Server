<script setup lang="ts">
defineProps<{
	color?: 'coral' | 'blue' | 'orange' | 'green' | 'purple' | 'teal' | 'dark'
	size?: 'sm' | 'md' | 'lg'
	roundness?: 'full' | 'rounded' | 'subtle'
	depth?: 'high' | 'medium' | 'flat'
	disabled?: boolean
}>()
</script>

<template>
	<button
		class="bbtn"
		:class="[
			`bbtn--${color ?? 'coral'}`,
			`bbtn--${size ?? 'md'}`,
			`bbtn--r-${roundness ?? 'full'}`,
			`bbtn--d-${depth ?? 'high'}`,
		]"
		:disabled="disabled"
	>
		<slot />
	</button>
</template>

<style scoped>
.bbtn {
	border: none;
	font-weight: 700;
	font-family: inherit;
	cursor: pointer;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	transition: transform 0.1s, box-shadow 0.1s;
	white-space: nowrap;
}

.bbtn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

/* Sizes */
.bbtn--sm { padding: 8px 16px; font-size: 11px; }
.bbtn--md { padding: 12px 28px; font-size: 13px; }
.bbtn--lg { padding: 16px 40px; font-size: 15px; }

/* Roundness */
.bbtn--r-full    { border-radius: 999px; }
.bbtn--r-rounded { border-radius: 12px; }
.bbtn--r-subtle  { border-radius: 6px; }

/* Colors */
.bbtn--coral  { background: var(--bal-coral);       color: var(--bal-white); }
.bbtn--blue   { background: var(--bal-blue);        color: var(--bal-white); }
.bbtn--orange { background: var(--bal-amber);       color: var(--bal-white); }
.bbtn--green  { background: var(--bal-green);       color: var(--bal-white); }
.bbtn--purple { background: var(--bal-purple);      color: var(--bal-white); }
.bbtn--teal   { background: var(--bal-panel-light); color: var(--bal-gray-blue); }
.bbtn--dark   { background: var(--bal-panel);       color: var(--bal-gray-blue); }

/* Depth — high */
.bbtn--coral.bbtn--d-high  { box-shadow: 0 5px 0 var(--bal-red-dark),    0 7px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
.bbtn--blue.bbtn--d-high   { box-shadow: 0 5px 0 var(--bal-blue-dark),   0 7px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
.bbtn--orange.bbtn--d-high { box-shadow: 0 5px 0 var(--bal-amber-dark),  0 7px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
.bbtn--green.bbtn--d-high  { box-shadow: 0 5px 0 var(--bal-green-dark),  0 7px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
.bbtn--purple.bbtn--d-high { box-shadow: 0 5px 0 var(--bal-purple-dark), 0 7px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
.bbtn--teal.bbtn--d-high   { box-shadow: 0 5px 0 var(--bal-panel),       0 7px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
.bbtn--dark.bbtn--d-high   { box-shadow: 0 5px 0 var(--bal-panel-dark),  0 7px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }

/* Depth — medium */
.bbtn--coral.bbtn--d-medium  { box-shadow: 0 3px 0 var(--bal-red-dark),    0 4px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }
.bbtn--blue.bbtn--d-medium   { box-shadow: 0 3px 0 var(--bal-blue-dark),   0 4px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }
.bbtn--orange.bbtn--d-medium { box-shadow: 0 3px 0 var(--bal-amber-dark),  0 4px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }
.bbtn--green.bbtn--d-medium  { box-shadow: 0 3px 0 var(--bal-green-dark),  0 4px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }
.bbtn--purple.bbtn--d-medium { box-shadow: 0 3px 0 var(--bal-purple-dark), 0 4px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }
.bbtn--teal.bbtn--d-medium   { box-shadow: 0 3px 0 var(--bal-panel),       0 4px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }
.bbtn--dark.bbtn--d-medium   { box-shadow: 0 3px 0 var(--bal-panel-dark),  0 4px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }

/* Depth — flat */
.bbtn--d-flat { box-shadow: 0 1px 3px rgba(0,0,0,0.2); }

/* Active press handled globally in tokens.css */
</style>
