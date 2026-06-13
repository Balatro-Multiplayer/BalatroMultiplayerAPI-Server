<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const required = [
	{ name: 'Balatro Multiplayer', url: 'https://github.com/V-rtualized/BalatroMultiplayer/releases' },
	{ name: 'Lovely', url: 'https://github.com/ethangreen-dev/lovely-injector' },
	{ name: 'Steammodded', url: 'https://github.com/Steamodded/smods' },
]

const qol = [
	{ name: 'Score Preview Integration (Preview-MultiplayerIntegration)', url: null, note: 'Multiplayer Config' },
	{ name: 'Balatro Typist (Hotkeys)', url: 'https://github.com/janw4ld/balatro-typist-mod' },
	{ name: 'Better Mouse and Gamepad (Multiselect)', url: 'https://github.com/Kooluve/Better-Mouse-And-Gamepad' },
	{ name: 'Black Deck Check', url: 'https://github.com/V-rtualized/BalatroBlackDeckCheck/releases' },
	{ name: 'Cartomancer (Performance, UI Clutter)', url: 'https://github.com/stupxd/Cartomancer' },
	{ name: 'Condensed UI', url: 'https://github.com/Hoversquid/Condensed_UI' },
	{ name: 'Dismiss Alert', url: 'https://github.com/Breezebuilder/DismissAlert' },
	{ name: 'Flower Pot (Player Stats)', url: 'https://github.com/GauntletGames-2086/Flower-Pot' },
	{ name: 'Flush Hotkeys', url: 'https://github.com/Agoraaa/FlushHotkeys' },
	{ name: 'Galdur (Deck and Stake Menu)', url: 'https://github.com/Eremel/Galdur' },
	{ name: 'Handy', url: 'https://github.com/SleepyG11/HandyBalatro', note: 'Multiplayer disables banned features' },
	{ name: 'Joker Display', url: 'https://github.com/nh6574/JokerDisplay' },
	{ name: 'Joker Sell Value', url: 'https://github.com/OppositeWolf770/JokerSellValue' },
	{ name: 'Mobile Like Drag', url: 'https://www.nexusmods.com/balatro/mods/133' },
	{ name: 'Next Ante Preview', url: 'https://github.com/DigitalDetective47/next-ante-preview' },
	{ name: 'Overflow', url: 'https://github.com/lord-ruby/Overflow' },
	{ name: 'Set FPS', url: 'https://github.com/tanakrit-d/SetFPS' },
	{ name: 'Sticky Fingers', url: 'https://github.com/eramdam/sticky-fingers/' },
	{ name: 'Suit Order (Customization)', url: 'https://github.com/DigitalDetective47/suit-order' },
	{ name: 'System Clock', url: 'https://github.com/Breezebuilder/SystemClock' },
	{ name: 'Too Many Jokers (Collection Menu)', url: 'https://github.com/cg-223/toomanyjokers' },
	{ name: 'UnBlind', url: 'https://github.com/MeraGenio/UnBlind' },
	{ name: 'Vortex', url: 'https://github.com/Kekulism/Vortex/' },
	{ name: 'The Family', url: 'https://github.com/SleepyG11/TheFamilyBalatro' },
	{ name: 'Riff Raff', url: 'https://github.com/its-edalo/riff-raff' },
]

const cosmetic = [
	'Aiko Paint Job', 'B-Side', 'Baba Decks', 'BalaGay', 'Balatro Collab', 'Balatro Dark Mode',
	'Balatro Wilds', 'Blueprint dynamic textures', 'BUMod', 'Celestial Funk', 'Colorblind Seals',
	'Colored Suit Tarots', 'Deck Skins', 'ENA: Dream BBQ Deck', 'GigaJokers', 'Gradient Suit Colors',
	'Guilty Gear Skin Mod', 'Hunatro', 'Legendere Jokers', 'LGBT Mult Cards', 'Malverk', 'Neco-Arc',
	'Oneshot Deck', 'Pokemon Face Cards', 'Shoot the Jumbo', 'Slay the Jokers', 'Soiree Music Pack',
	'Soup', 'Specralsbian', 'SpecTrans', 'Stickers Always Shown', 'Sun is Sus', 'TackySuit',
	'Trance', 'Vocalatro', 'Yuri Blueprint Brainstorm', 'Dragon Ball Saiyan Face Cards', 'SealSeal',
	'Deltarune Cards', 'Baldatro', 'BalaQuints', 'Main Menu Tweaks', 'BALATRIN GAMING',
	'Rain World Karma Deck', 'Mewing Jokers', 'Sailor Moon Planet Cards', 'Hat In Time Deck Skin',
	'Sonic CD Deck', 'Waifu Jokers',
]

const localization = [
	{ name: 'Balatro ProperRussian', url: 'https://github.com/Nitablade/Balatro_ProperRussian' },
	{ name: 'Balatro Reo Māori', url: null },
	{ name: 'Balatro Thai', url: 'https://github.com/korewaChino/balatro-thai' },
	{ name: 'Vietnamese Balatro (VNBalatro)', url: 'https://github.com/HuyTheKiller/VietnameseBalatro' },
]
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Approved Mods</h1>
		<p class="doc-lead">Use only these mods for ranked / queue unless staff says otherwise.</p>

		<div class="rule-pills">
			<span class="pill pill--green">✓ Cosmetic-only mods are allowed</span>
			<span class="pill pill--green">✓ Language-only mods are allowed</span>
			<NuxtLink to="/docs/multiplayer-content/banned-mods" class="pill pill--red">View banned mods →</NuxtLink>
		</div>

		<!-- Required -->
		<section class="doc-section">
			<h2 class="doc-h2">Required ({{ required.length }})</h2>
			<div class="mod-table">
				<div class="mod-row mod-row--header">
					<span>Name</span>
					<span>Download</span>
				</div>
				<div v-for="mod in required" :key="mod.name" class="mod-row">
					<span class="mod-name">{{ mod.name }}</span>
					<a :href="mod.url!" target="_blank" rel="noopener noreferrer" class="mod-link">Link ↗</a>
				</div>
			</div>
		</section>

		<!-- QoL -->
		<section class="doc-section">
			<h2 class="doc-h2">Quality of Life ({{ qol.length }})</h2>
			<div class="mod-table">
				<div class="mod-row mod-row--header">
					<span>Name</span>
					<span>Download</span>
				</div>
				<div v-for="mod in qol" :key="mod.name" class="mod-row">
					<span class="mod-name">{{ mod.name }}</span>
					<a v-if="mod.url" :href="mod.url" target="_blank" rel="noopener noreferrer" class="mod-link">Link ↗</a>
					<span v-else class="mod-note">{{ mod.note }}</span>
				</div>
			</div>
		</section>

		<!-- Cosmetic (collapsed list) -->
		<section class="doc-section">
			<h2 class="doc-h2">Cosmetic ({{ cosmetic.length }})</h2>
			<div class="cosmetic-grid">
				<span v-for="name in cosmetic" :key="name" class="cosmetic-pill">{{ name }}</span>
			</div>
		</section>

		<!-- Localization -->
		<section class="doc-section">
			<h2 class="doc-h2">Localization ({{ localization.length }})</h2>
			<div class="mod-table">
				<div class="mod-row mod-row--header">
					<span>Name</span>
					<span>Download</span>
				</div>
				<div v-for="mod in localization" :key="mod.name" class="mod-row">
					<span class="mod-name">{{ mod.name }}</span>
					<a v-if="mod.url" :href="mod.url" target="_blank" rel="noopener noreferrer" class="mod-link">Link ↗</a>
					<span v-else class="mod-note">Discord</span>
				</div>
			</div>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Other (1)</h2>
			<div class="mod-table">
				<div class="mod-row mod-row--header"><span>Name</span><span>Download</span></div>
				<div class="mod-row">
					<span class="mod-name">Distro</span>
					<a href="https://github.com/dvrp0/distro" target="_blank" rel="noopener noreferrer" class="mod-link">Link ↗</a>
				</div>
			</div>
		</section>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 { font-size: 22px; color: var(--bal-white); text-shadow: 3px 3px 0 rgba(0,0,0,0.4); margin-bottom: 12px; }
.doc-h2 { font-size: 13px; color: var(--bal-cream); margin-bottom: 12px; font-weight: 700; }
.doc-lead { font-size: 10px; color: var(--bal-teal-gray); line-height: 2.2; margin-bottom: 20px; }
.doc-section { margin-bottom: 32px; }

.rule-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
.pill {
	font-size: 9px; font-weight: 700; padding: 6px 14px; border-radius: 999px;
	white-space: nowrap;
}
.pill--green { background: rgba(86,167,134,0.15); color: var(--bal-green); border: 2px solid rgba(86,167,134,0.3); }
.pill--red { background: rgba(253,95,85,0.15); color: var(--bal-coral); border: 2px solid rgba(253,95,85,0.3); text-decoration: none; }

.mod-table {
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-dark);
	border-radius: 12px;
	overflow: hidden;
}
.mod-row {
	display: grid;
	grid-template-columns: 1fr 80px;
	padding: 9px 14px;
	border-bottom: 1px solid rgba(0,0,0,0.15);
	align-items: center;
	gap: 12px;
}
.mod-row:last-child { border-bottom: none; }
.mod-row--header {
	background: var(--bal-panel-dark);
	font-size: 8px;
	color: var(--bal-gray-blue);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}
.mod-name { font-size: 9px; color: var(--bal-white); line-height: 1.6; }
.mod-link { font-size: 9px; color: var(--bal-blue); font-weight: 700; }
.mod-link:hover { color: var(--bal-blue-light); }
.mod-note { font-size: 9px; color: var(--bal-gray-mid); }

.cosmetic-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.cosmetic-pill {
	font-size: 9px; color: var(--bal-teal-gray);
	background: var(--bal-panel); border: 2px solid var(--bal-panel-dark);
	border-radius: 999px; padding: 5px 12px;
}
</style>
