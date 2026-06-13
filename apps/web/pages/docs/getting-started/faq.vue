<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const openItems = ref<Set<number>>(new Set())
function toggle(i: number) {
	if (openItems.value.has(i)) openItems.value.delete(i)
	else openItems.value.add(i)
}

const faqs = [
	{
		q: 'How does the mod work?',
		a: `When you install the mod you'll have two extra buttons on the main menu: start a lobby and join a lobby.
The host gets to choose game mode options and shares a lobby code with others.
In the most popular mode, both players play small and big blinds normally — every boss blind becomes a PvP blind where you compete for the higher score.
You won't lose when you fail a blind, but you lose a life every time you lose to your opponent. The lobby host can configure lives, rules, and more.`,
	},
	{
		q: "I'm having trouble installing the mod — what do I do?",
		a: `Check out the <a href="/docs/getting-started/installation" class="faq-link">Installation guide</a>. If you've followed the steps and still have issues, open a support ticket in the <a href="https://discord.com/channels/1226193436521267223/1227357106064326727" target="_blank" rel="noopener" class="faq-link">Discord server</a> and a Developer, Admin, or Helper will help ASAP.`,
	},
	{
		q: 'Do I need to run my own server to play with friends?',
		a: `<strong>No</strong> — there's an official server you'll automatically connect to when you launch Balatro with the mod installed. If you want to host a private server, see <a href="/docs/advanced/private-server" class="faq-link">Private Server Setup</a>.`,
	},
	{
		q: 'Can I play with more than 2 people?',
		a: `Yes! Download the experimental version (easiest via the Launcher, or grab it from <a href="https://discord.com/channels/1226193436521267223/1326278546175299614" target="_blank" rel="noopener" class="faq-link">#changelog</a> in Discord).
The experimental version includes:
<br/>• <strong>Hivemind</strong> — team format, up to 8 players / 4 teams
<br/>• <strong>Potluck</strong> — face all players at once, beat the average score to win`,
	},
	{
		q: 'How do I find other players to play with?',
		a: `Go to <a href="https://discord.com/channels/1226193436521267223/1226597231289827458" target="_blank" rel="noopener" class="faq-link">#custom-lfg</a> in the Discord server.
Grab the <strong>The Lovers (LFG)</strong> role from <a href="https://discord.com/channels/1226193436521267223/1227405578268315708" target="_blank" rel="noopener" class="faq-link">#roles</a> — anyone with the role welcomes pings in the LFG channel.`,
	},
	{
		q: 'Is there a way to see my opponent\'s jokers or hands?',
		a: `Not yet. This may be implemented as a game mechanic in a future update (e.g., as a joker or voucher effect) rather than free information.`,
	},
	{
		q: 'My browser or antivirus warns me about Lovely — is it safe?',
		a: `<strong>Lovely is safe.</strong> It gets flagged because it's technically a trojan — it injects mod code into the Balatro executable so mods can modify the game. That capability is dangerous if misused, which is why it trips AV scanners.
<br/><br/>Lovely itself only injects the mods in your Mods folder. That said, <strong>be careful which mods you install</strong> — any injected mod has the same access rights as Balatro itself.`,
	},
	{
		q: 'Does the mod work on App Store / Mobile / Switch / Console?',
		a: `No. Those platforms use different versions of Balatro that differ enough that the mod won't work, and modding them is generally not feasible.`,
	},
]
</script>

<template>
	<div class="doc-page">
		<h1 class="doc-h1">Frequently Asked Questions</h1>
		<p class="doc-lead">Answers to common questions about the Balatro Multiplayer mod.</p>

		<div class="faq-list">
			<div
				v-for="(item, i) in faqs"
				:key="i"
				class="faq-item"
				:class="{ 'faq-item--open': openItems.has(i) }"
			>
				<button class="faq-q" @click="toggle(i)">
					<span>{{ item.q }}</span>
					<span class="faq-arrow">{{ openItems.has(i) ? '▲' : '▼' }}</span>
				</button>
				<Transition name="faq-expand">
					<div v-if="openItems.has(i)" class="faq-a" v-html="item.a" />
				</Transition>
			</div>
		</div>
	</div>
</template>

<style scoped>
.doc-page { max-width: 720px; }
.doc-h1 { font-size: 22px; color: var(--bal-white); text-shadow: 3px 3px 0 rgba(0,0,0,0.4); margin-bottom: 12px; }
.doc-lead { font-size: 10px; color: var(--bal-teal-gray); line-height: 2.2; margin-bottom: 32px; }

.faq-list { display: flex; flex-direction: column; gap: 8px; }

.faq-item {
	background: var(--bal-panel);
	border: 2px solid var(--bal-panel-dark);
	box-shadow: inset 0 1px 4px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.3);
	border-radius: 12px;
	overflow: hidden;
	transition: border-color 0.15s;
}

.faq-item--open { border-color: rgba(253,95,85,0.3); }

.faq-q {
	width: 100%;
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	padding: 16px 18px;
	background: none;
	border: none;
	cursor: pointer;
	color: var(--bal-cream);
	font-family: inherit;
	font-size: 11px;
	font-weight: 700;
	text-align: left;
	line-height: 1.6;
}

.faq-q:hover { color: var(--bal-white); }

.faq-arrow {
	color: var(--bal-coral);
	font-size: 9px;
	flex-shrink: 0;
}

.faq-a {
	padding: 0 18px 18px;
	font-size: 10px;
	color: var(--bal-gray-blue);
	line-height: 2.2;
	border-top: 1px solid rgba(0,0,0,0.2);
	padding-top: 14px;
}

:deep(.faq-link) { color: var(--bal-blue); }
:deep(.faq-link:hover) { color: var(--bal-blue-light); }

.faq-expand-enter-active,
.faq-expand-leave-active { transition: opacity 0.2s; }
.faq-expand-enter-from,
.faq-expand-leave-to { opacity: 0; }
</style>
