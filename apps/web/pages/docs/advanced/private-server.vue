<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const activeOs = ref<'windows' | 'mac' | 'linux'>('windows')
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Private Server Setup</h1>
		<p class="doc-lead">Host your own Balatro Multiplayer server for private games or LAN play.</p>

		<section class="doc-section">
			<h2 class="doc-h2">Starting a Server</h2>
			<p class="doc-p">Each release includes server files for Windows, Mac, and Linux. Download from the <a href="https://github.com/Balatro-Multiplayer/BalatroMultiplayer/releases/latest" target="_blank" rel="noopener" class="doc-link">latest release</a>.</p>

			<div class="tabs">
				<button
					v-for="os in ['windows', 'mac', 'linux'] as const"
					:key="os"
					class="tab-btn"
					:class="{ 'tab-btn--active': activeOs === os }"
					@click="activeOs = os"
				>
					{{ { windows: 'Windows', mac: 'Mac', linux: 'Linux' }[os] }}
				</button>
			</div>

			<div class="tab-content">
				<div v-if="activeOs === 'windows'" class="tab-body">
					<p class="doc-p">Download <code>server-win.exe</code> from the latest release and run it directly — no additional steps needed.</p>
				</div>
				<div v-else-if="activeOs === 'mac'" class="tab-body">
					<p class="doc-p">Download <code>server-macos</code> from the latest release, then:</p>
					<pre class="code-block">cd /path/to/server-macos
chmod +x server-macos
./server-macos</pre>
				</div>
				<div v-else class="tab-body">
					<p class="doc-p">Download <code>server-linux</code> from the latest release, then:</p>
					<pre class="code-block">cd /path/to/server-linux
chmod +x server-linux
./server-linux</pre>
				</div>
			</div>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Connecting to Your Server</h2>
			<p class="doc-p">
				Players need to edit their <code>Multiplayer.jkr</code> config file, located in Balatro's save folder.
				On Windows this is <code>%AppData%/Balatro/config/</code>.
				Launch the game with the mod installed at least once to generate the file.
			</p>

			<p class="doc-p">The file looks like this by default:</p>
			<pre class="code-block">return {
	["misprint_display"] = true,
	["logging"] = false,
	["integrations"] = {
		["TheOrder"] = false,
	},
	["username"] = "Guest",
	["server_url"] = "balatro.virtualized.dev",
	["server_port"] = 8788,
}</pre>

			<p class="doc-p">For <strong class="hl">LAN play</strong>, change <code>server_url</code> to <code>"localhost"</code>:</p>
			<pre class="code-block">	["server_url"] = "localhost",  -- point at your local machine
	["server_port"] = 8788,</pre>

			<p class="doc-p">For <strong class="hl">internet hosting</strong>, set <code>server_url</code> to your public IP (find it at <a href="https://www.whatismyip.com" target="_blank" rel="noopener" class="doc-link">whatismyip.com</a>) and forward port <code>8788</code> in your router. Alternatively, use a tunnel service like <strong class="hl">Tailscale</strong>, <strong class="hl">ZeroTier</strong>, or <strong class="hl">Hamachi</strong> to avoid port forwarding entirely.</p>
		</section>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 { font-size: 22px; color: var(--bal-white); text-shadow: 3px 3px 0 rgba(0,0,0,0.4); margin-bottom: 12px; }
.doc-h2 { font-size: 15px; color: var(--bal-cream); margin-bottom: 14px; font-weight: 700; }
.doc-lead { font-size: 10px; color: var(--bal-teal-gray); line-height: 2.2; margin-bottom: 32px; }
.doc-p { font-size: 10px; color: var(--bal-gray-blue); line-height: 2.2; margin-bottom: 12px; }
.doc-section { margin-bottom: 40px; }
.doc-link { color: var(--bal-blue); }
.hl { color: var(--bal-cream); }

.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tab-btn {
	background: var(--bal-panel); border: 2px solid var(--bal-panel-dark);
	color: var(--bal-teal-gray); font-family: inherit; font-size: 9px; font-weight: 700;
	padding: 8px 16px; border-radius: 999px; cursor: pointer; transition: all 0.1s;
}
.tab-btn:hover { color: var(--bal-white); }
.tab-btn--active { background: var(--bal-coral); border-color: var(--bal-red-dark); color: var(--bal-white); }

.tab-content { background: var(--bal-panel-dark); border-radius: 12px; padding: 20px; }

.code-block {
	background: rgba(0,0,0,0.4);
	border: 2px solid rgba(0,0,0,0.3);
	border-radius: 10px;
	padding: 16px;
	font-size: 9px;
	color: var(--bal-cream);
	font-family: 'Courier New', monospace;
	line-height: 2;
	overflow-x: auto;
	margin: 12px 0;
	-webkit-font-smoothing: auto;
}

code {
	background: rgba(0,0,0,0.3);
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 9px;
	font-family: 'Courier New', monospace;
	color: var(--bal-cream);
}
</style>
