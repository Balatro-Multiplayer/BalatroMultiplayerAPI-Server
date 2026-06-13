<template>
	<div class="swirl-root" aria-hidden="true">
		<div class="swirl-layer1" />
		<div class="swirl-layer2" />
	</div>
</template>

<style scoped>
.swirl-root {
	position: fixed;
	inset: 0;
	z-index: 0;
	overflow: hidden;
	background: var(--bal-panel-dark);
	pointer-events: none;
}

.swirl-layer1 {
	position: absolute;
	inset: -60%;
	width: 220%;
	height: 220%;
	background:
		radial-gradient(ellipse at 25% 15%, #a61a1fdc 0%, transparent 45%),
		radial-gradient(ellipse at 75% 85%, #ec2d33c8 0%, transparent 45%),
		radial-gradient(ellipse at 55% 45%, #0081d3f0 0%, transparent 55%),
		radial-gradient(ellipse at 85% 25%, #a61a1f8c 0%, transparent 35%),
		radial-gradient(ellipse at 15% 75%, #634d8464 0%, transparent 40%);
	animation: swirl1 22s ease-in-out infinite;
}

.swirl-layer2 {
	position: absolute;
	inset: -30%;
	width: 160%;
	height: 160%;
	background:
		radial-gradient(circle at 65% 35%, #ec2d3399 0%, transparent 35%),
		radial-gradient(circle at 30% 70%, #0081d3aa 0%, transparent 40%);
	animation: swirl2 17s ease-in-out infinite;
	mix-blend-mode: screen;
}

@keyframes swirl1 {
	0%, 100% { transform: translate(0%, 0%) rotate(0deg) scale(1); }
	25%       { transform: translate(4%, -2%) rotate(2deg) scale(1.04); }
	50%       { transform: translate(-2%, 4%) rotate(-1.5deg) scale(1.02); }
	75%       { transform: translate(1%, 1%) rotate(1deg) scale(1.06); }
}

@keyframes swirl2 {
	0%, 100% { transform: translate(0%, 0%) rotate(0deg); }
	33%       { transform: translate(-4%, 2%) rotate(-3deg); }
	66%       { transform: translate(3%, -3%) rotate(2.5deg); }
}
</style>
