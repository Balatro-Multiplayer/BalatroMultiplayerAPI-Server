<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const activeTab = ref<'launcher' | 'windows' | 'mac' | 'linux'>('launcher')
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Installation</h1>
		<p class="doc-lead">Learn how to install the Balatro Multiplayer mod.</p>

		<section class="doc-section">
			<h2 class="doc-h2">Recommended: Using the Balatro Multiplayer Launcher</h2>
			<p class="doc-p">The easiest way to install and manage the Balatro Multiplayer mod is by using our official launcher.</p>

			<div class="steps">
				<div class="step">
					<div class="step-num">1</div>
					<div class="step-body">
						<h3 class="step-title">Download the Launcher</h3>
						<p class="step-desc">Download the official Balatro Multiplayer Launcher for your operating system.</p>
						<a
							href="https://github.com/Balatro-Multiplayer/Balatro-Multiplayer-Launcher/releases"
							target="_blank"
							rel="noopener noreferrer"
							class="doc-btn"
						>
							⬇ Get the Launcher
						</a>
					</div>
				</div>
				<div class="step">
					<div class="step-num">2</div>
					<div class="step-body">
						<h3 class="step-title">Run the Launcher</h3>
						<p class="step-desc">Open the downloaded launcher and follow the on-screen instructions to install the mod.</p>
					</div>
				</div>
			</div>

			<div class="callout">
				The launcher will automatically install all required dependencies (Lovely and Steamodded), download and install the
				selected version of the mod, and lets you switch versions in one click — perfect for tournament or experimental builds.
			</div>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Alternative: Manual Installation</h2>

			<div class="steps">
				<div class="step">
					<div class="step-num">1</div>
					<div class="step-body">
						<h3 class="step-title">Install Lovely and Steamodded</h3>
						<p class="step-desc">Follow the guide at <a href="https://github.com/Steamopollys/Steamodded/wiki" target="_blank" rel="noopener" class="doc-link">github.com/Steamopollys/Steamodded/wiki</a></p>
					</div>
				</div>
				<div class="step">
					<div class="step-num">2</div>
					<div class="step-body">
						<h3 class="step-title">Download the Multiplayer Mod</h3>
						<a
							href="https://github.com/Balatro-Multiplayer/BalatroMultiplayer/releases/latest/download/BalatroMultiplayer.zip"
							target="_blank"
							rel="noopener noreferrer"
							class="doc-btn"
						>
							⬇ Download latest version
						</a>
					</div>
				</div>
				<div class="step">
					<div class="step-num">3</div>
					<div class="step-body">
						<h3 class="step-title">Add to your Mods folder</h3>
						<p class="step-desc">Unzip <code>BalatroMultiplayer.zip</code> and place the folder in the Mods directory described by the Steamodded instructions.</p>
					</div>
				</div>
			</div>

			<p class="doc-p">If you need help, open a ticket in the <a href="https://discord.com/channels/1226193436521267223/1227357106064326727" target="_blank" rel="noopener" class="doc-link">Discord server</a>.</p>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Video Instructions</h2>
			<p class="doc-p">While these videos show the manual process, we recommend using the Launcher above for the easiest experience.</p>

			<div class="tabs">
				<button
					v-for="t in ['launcher', 'windows', 'mac', 'linux'] as const"
					:key="t"
					class="tab-btn"
					:class="{ 'tab-btn--active': activeTab === t }"
					@click="activeTab = t"
				>
					{{ { launcher: 'Launcher', windows: 'Windows', mac: 'Mac', linux: 'Linux/SteamDeck' }[t] }}
				</button>
			</div>

			<div class="tab-content">
				<div v-if="activeTab === 'launcher'" class="tab-cta">
					<p class="doc-p">The Balatro Multiplayer Launcher is the easiest way to install and manage the mod.</p>
					<a href="https://github.com/Balatro-Multiplayer/Balatro-Multiplayer-Launcher/releases" target="_blank" rel="noopener noreferrer" class="doc-btn">
						⬇ Get the Launcher
					</a>
				</div>
				<div v-else-if="activeTab === 'windows'" class="video-wrap">
					<iframe src="https://www.youtube.com/embed/iqTpHz5vZgA" title="Windows installation" frameborder="0" allowfullscreen />
				</div>
				<div v-else-if="activeTab === 'mac'" class="video-wrap">
					<iframe src="https://www.youtube.com/embed/05Hs8f1t8eo" title="Mac installation" frameborder="0" allowfullscreen />
				</div>
				<div v-else class="video-wrap">
					<iframe src="https://www.youtube.com/embed/zaVy_AwojQk" title="Linux/SteamDeck installation" frameborder="0" allowfullscreen />
				</div>
			</div>
		</section>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 { font-size: 22px; color: var(--bal-white); text-shadow: 3px 3px 0 rgba(0,0,0,0.4); margin-bottom: 12px; }
.doc-h2 { font-size: 15px; color: var(--bal-cream); margin-bottom: 14px; font-weight: 700; }
.doc-lead { font-size: 10px; color: var(--bal-teal-gray); line-height: 2.2; margin-bottom: 32px; }
.doc-p { font-size: 10px; color: var(--bal-gray-blue); line-height: 2.2; margin-bottom: 16px; }
.doc-section { margin-bottom: 40px; }
.doc-link { color: var(--bal-blue); }
.doc-link:hover { color: var(--bal-blue-light); }

.steps { display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px; }
.step { display: flex; gap: 16px; align-items: flex-start; }
.step-num {
	width: 32px; height: 32px; border-radius: 50%;
	background: var(--bal-coral); color: var(--bal-white);
	font-size: 13px; font-weight: 900;
	display: flex; align-items: center; justify-content: center;
	flex-shrink: 0;
	box-shadow: 0 3px 0 var(--bal-red-dark);
}
.step-title { font-size: 12px; color: var(--bal-white); font-weight: 700; margin-bottom: 8px; }
.step-desc { font-size: 9px; color: var(--bal-gray-blue); line-height: 2; margin-bottom: 12px; }
.step-body code { background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 9px; }

.callout {
	background: rgba(0,156,253,0.08);
	border-left: 3px solid var(--bal-blue);
	border-radius: 0 10px 10px 0;
	padding: 14px 16px;
	font-size: 9px;
	color: var(--bal-teal-gray);
	line-height: 2;
	margin-bottom: 16px;
}

.doc-btn {
	display: inline-flex; align-items: center; gap: 8px;
	background: var(--bal-blue); color: var(--bal-white);
	font-family: inherit; font-size: 11px; font-weight: 700;
	padding: 10px 20px; border-radius: 999px; border: none;
	cursor: pointer; text-decoration: none;
	box-shadow: 0 4px 0 var(--bal-blue-dark), 0 6px 12px rgba(0,0,0,0.3);
	transition: transform 0.1s;
}
.doc-btn:hover { color: var(--bal-white); transform: translateY(-2px); }
.doc-btn:active { transform: translateY(2px); }

.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.tab-btn {
	background: var(--bal-panel); border: 2px solid var(--bal-panel-dark);
	color: var(--bal-teal-gray); font-family: inherit; font-size: 9px; font-weight: 700;
	padding: 8px 16px; border-radius: 999px; cursor: pointer;
	transition: all 0.1s;
}
.tab-btn:hover { color: var(--bal-white); }
.tab-btn--active { background: var(--bal-coral); border-color: var(--bal-red-dark); color: var(--bal-white); }

.tab-content { background: var(--bal-panel-dark); border-radius: 12px; padding: 20px; }
.tab-cta { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; }

.video-wrap { position: relative; padding-bottom: 56.25%; height: 0; }
.video-wrap iframe { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 8px; }
</style>
