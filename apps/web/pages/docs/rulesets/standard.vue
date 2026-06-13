<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const mpJokers = [
	{
		name: 'Defensive Joker',
		img: null,
		desc: '+125 Chips for every life less than your opponent.',
	},
	{
		name: 'Skip-Off',
		img: null,
		desc: '+1 Hand and +1 Discard per additional blind skipped compared to your opponent.',
	},
	{
		name: "Let's Go Gambling",
		img: null,
		desc: '1 in 4 chance for X4 Mult and $10. 1 in 4 chance to give your opponent $10 in PvP Blind.',
	},
	{
		name: 'Speedrun',
		img: null,
		desc: 'If you reach a PvP Blind before your opponent, create a random Spectral card. Must have room.',
	},
	{
		name: 'Conjoined Joker',
		img: null,
		desc: 'While in a PvP Blind, gain X0.5 Mult for every hand your opponent has left (Max X3 Mult).',
	},
	{
		name: 'Penny Pincher',
		img: null,
		desc: 'At start of shop, gain $1 for every $3 your opponent spent in the corresponding shop last ante.',
	},
	{
		name: 'Taxes',
		img: null,
		desc: 'Gains +4 Mult for every card your opponent sold since last PvP Blind, updates when PvP Blind is selected.',
	},
	{
		name: 'Pizza',
		img: null,
		desc: 'At end of next PvP Blind, consume this Joker and grant +1 discard to you and +2 discards to your opponent for the ante.',
	},
	{
		name: 'Pacifist',
		img: null,
		desc: 'X10 Mult while not in a PvP Blind.',
	},
]

const disabledJokers = [
	{ name: 'Chicot', desc: 'Disables effect of every Boss Blind' },
	{ name: 'Matador', desc: 'Earn $8 if played hand triggers the Boss Blind ability' },
	{ name: 'Mr. Bones', desc: 'Prevents Death if chips scored are at least 25% of required chips. Self destructs.' },
	{ name: 'Luchador', desc: 'Sell this card to disable the current Boss Blind' },
]

const modifiedJokers = [
	{ name: 'Hanging Chad', change: 'Retriggers first and second played cards 1 additional time (unchanged from base)' },
	{ name: 'Seltzer', change: 'Starts at 8 hands instead of the base game\'s 10' },
	{ name: 'Turtle Bean', change: 'Starts at +4 hand size instead of the base game\'s 5' },
	{ name: 'Golden Ticket', change: 'Gives $3 instead of $4. Changed to Uncommon rarity. No longer requires Gold card in deck to appear.' },
]
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Standard Ranked</h1>
		<p class="doc-lead">The Standard Ranked ruleset includes Multiplayer cards and balance changes to the base game for competitive play.</p>

		<section class="doc-section">
			<h2 class="doc-h2">Gameplay Changes</h2>
			<ul class="change-list">
				<li>Comeback money is only given during PvP blinds (not outside of PvP)</li>
				<li>Comeback money is a flat <strong class="hl">$4</strong> regardless of lives lost</li>
				<li>Comeback money is halved to <strong class="hl">$2</strong> on Blue stake and above</li>
			</ul>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Multiplayer Jokers</h2>
			<p class="doc-p">There are <strong class="hl">10 added multiplayer jokers</strong>. All interact with your opponent and only appear in multiplayer games.</p>
			<div class="joker-table">
				<div class="joker-row joker-row--header">
					<span>Joker</span>
					<span>Effect</span>
				</div>
				<div v-for="j in mpJokers" :key="j.name" class="joker-row">
					<span class="joker-name">{{ j.name }}</span>
					<span class="joker-desc">{{ j.desc }}</span>
				</div>
			</div>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Disabled Jokers</h2>
			<p class="doc-p">These jokers are <strong class="hl">unavailable</strong> in multiplayer due to their interaction with boss blinds.</p>
			<div class="joker-table">
				<div class="joker-row joker-row--header">
					<span>Joker</span>
					<span>Reason</span>
				</div>
				<div v-for="j in disabledJokers" :key="j.name" class="joker-row">
					<span class="joker-name joker-name--banned">{{ j.name }}</span>
					<span class="joker-desc">{{ j.desc }}</span>
				</div>
			</div>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Modified Jokers</h2>
			<p class="doc-p">These jokers have been rebalanced from their base game versions.</p>
			<div class="joker-table">
				<div class="joker-row joker-row--header">
					<span>Joker</span>
					<span>Change</span>
				</div>
				<div v-for="j in modifiedJokers" :key="j.name" class="joker-row">
					<span class="joker-name">{{ j.name }}</span>
					<span class="joker-desc">{{ j.change }}</span>
				</div>
			</div>
		</section>

		<section class="doc-section">
			<h2 class="doc-h2">Key Card Changes</h2>
			<ul class="change-list">
				<li><strong class="hl">Glass Card:</strong> X1.5 Mult, 1 in 4 chance to destroy. Only obtainable from Standard packs or Spectral cards (Grim, Incantation, Familiar).</li>
				<li><strong class="hl">Asteroid (Planet):</strong> Removes one level from your opponent's highest-level poker hand.</li>
				<li><strong class="hl">Ouija (Spectral):</strong> Destroys 3 random cards in hand, sets remaining cards to the same rank. Reworked from base game.</li>
				<li><strong class="hl">Justice (Tarot):</strong> Not available in Standard Ranked.</li>
			</ul>
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
.hl { color: var(--bal-cream); }

.change-list {
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.change-list li {
	font-size: 10px;
	color: var(--bal-gray-blue);
	line-height: 2;
	padding-left: 16px;
	position: relative;
}
.change-list li::before {
	content: '•';
	position: absolute;
	left: 0;
	color: var(--bal-coral);
}

.joker-table {
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-dark);
	border-radius: 12px;
	overflow: hidden;
}

.joker-row {
	display: grid;
	grid-template-columns: 1.2fr 2fr;
	padding: 10px 14px;
	border-bottom: 1px solid rgba(0,0,0,0.15);
	gap: 16px;
	align-items: start;
}
.joker-row:last-child { border-bottom: none; }
.joker-row--header {
	background: var(--bal-panel-dark);
	font-size: 8px;
	color: var(--bal-gray-blue);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}
.joker-name { font-size: 10px; color: var(--bal-cream); font-weight: 700; }
.joker-name--banned { color: var(--bal-coral); }
.joker-desc { font-size: 9px; color: var(--bal-gray-blue); line-height: 2; }
</style>
