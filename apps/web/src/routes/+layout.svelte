<script lang="ts">
	let { children }: { children: import('svelte').Snippet } = $props()
</script>

<svelte:head>
	<title>Balatro Multiplayer</title>
</svelte:head>

<div class="app">
	<header>
		<a href="/" class="logo">Balatro Multiplayer</a>
	</header>

	<main>
		{@render children()}
	</main>

	<footer>
		<a href="/privacy">Privacy Policy</a>
		<a href="/tos">Terms of Service</a>
	</footer>
</div>

<style>
	:global(*) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		background: #0f0f13;
		color: #e0d8c8;
		font-family: system-ui, sans-serif;
		min-height: 100vh;
	}

	:global(a) {
		color: #c8a84b;
		text-decoration: none;
	}

	:global(a:hover) {
		text-decoration: underline;
	}

	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	header {
		display: flex;
		align-items: center;
		padding: 1rem 2rem;
		background: #16161d;
		border-bottom: 1px solid #2a2a38;
	}

	.logo {
		font-size: 1.2rem;
		font-weight: 600;
		color: #c8a84b;
	}

	main {
		flex: 1;
		padding: 2rem;
		max-width: 800px;
		width: 100%;
		margin: 0 auto;
	}

	footer {
		padding: 1.5rem 2rem;
		border-top: 1px solid #2a2a38;
		display: flex;
		gap: 1.5rem;
		justify-content: center;
		font-size: 0.8rem;
		color: #555;
	}

	footer a {
		color: #555;
	}

	footer a:hover {
		color: #888;
	}
</style>
