/**
 * Seed the chat_allowlist table with pre-approved common messages.
 * Run with: tsx src/db/seed-chat-allowlist.ts
 *
 * Messages are stored in normalized form:
 *   - lowercase + trimmed
 *   - trailing single '.', '!', '?' stripped (unless the whole string is punctuation)
 */

import { db } from './index.js'
import { chatAllowlist } from './schema.js'
import { sql } from 'drizzle-orm'

// Raw messages — normalization is applied before insert
const RAW_MESSAGES = [
	// Greetings / farewells
	'hello',
	'hi',
	'hey',
	'howdy',
	'sup',
	'what\'s up',
	'yo',
	'good morning',
	'good afternoon',
	'good evening',
	'good night',
	'goodbye',
	'bye',
	'later',
	'see you',
	'see ya',
	'cya',
	'take care',
	'have a good one',
	'welcome',
	'welcome back',

	// Acknowledgements / reactions
	'ok',
	'okay',
	'ok!',
	'sure',
	'sure!',
	'yep',
	'yep!',
	'yes',
	'yes!',
	'yeah',
	'yeah!',
	'nope',
	'no',
	'nah',
	'maybe',
	'idk',
	'i don\'t know',
	'not sure',
	'sounds good',
	'sounds good!',
	'sounds great',
	'sounds great!',
	'got it',
	'got it!',
	'understood',
	'roger',
	'copy that',
	'i see',
	'nice',
	'nice!',
	'cool',
	'cool!',
	'awesome',
	'awesome!',
	'great',
	'great!',
	'perfect',
	'perfect!',
	'excellent',
	'amazing',
	'amazing!',
	'wow',
	'wow!',
	'oh',
	'ah',
	'ok ok',
	'alright',
	'alright!',
	'fair enough',
	'fair enough.',
	'makes sense',
	'makes sense.',
	'that makes sense',

	// Courtesy
	'thanks',
	'thanks!',
	'thank you',
	'thank you!',
	'ty',
	'ty!',
	'np',
	'no problem',
	'no problem!',
	'no worries',
	'no worries!',
	'you\'re welcome',
	'yw',
	'good luck',
	'good luck!',
	'gl',
	'gl!',
	'have fun',
	'have fun!',
	'hf',
	'well played',
	'well played!',
	'wp',
	'wp!',
	'gg',
	'gg!',
	'good game',
	'good game!',
	'ggwp',
	'ggwp!',
	'nice game',
	'nice game!',
	'nice round',
	'nice round!',
	'nice hand',
	'nice hand!',
	'nice play',
	'nice play!',
	'nice move',
	'nice move!',
	'nice joker',
	'nice joker!',

	// Game state commentary
	'let\'s go',
	'let\'s go!',
	'let\'s do this',
	'here we go',
	'here we go!',
	'ready',
	'ready!',
	'i\'m ready',
	'i\'m ready!',
	'not ready yet',
	'starting',
	'let\'s start',
	'go',
	'go!',
	'wait',
	'wait!',
	'hold on',
	'hold on!',
	'one moment',
	'one sec',
	'brb',
	'back',
	'i\'m back',
	'i\'m back!',
	'afk',
	'ok i\'m back',

	// Reactions to hands / runs
	'oof',
	'oof!',
	'rip',
	'rip!',
	'that was close',
	'so close',
	'unlucky',
	'unlucky!',
	'lucky',
	'lucky!',
	'nice!',
	'nooo',
	'oh no',
	'oh no!',
	'oh man',
	'oh well',
	'lol',
	'lmao',
	'haha',
	'heh',
	'xd',

	// Pure punctuation (stored as-is, never stripped)
	'?',
	'!',
	'...',
]

function normalizeForAllowlist(message: string): string | null {
	const trimmed = message.trim()
	if (trimmed === '') return null
	const lower = trimmed.toLowerCase()
	if (/^[.!?]+$/.test(lower)) return lower
	if (lower.endsWith('.') || lower.endsWith('!') || lower.endsWith('?')) {
		return lower.slice(0, -1)
	}
	return lower
}

async function seed() {
	const normalized = [...new Set(RAW_MESSAGES.map(normalizeForAllowlist).filter((m): m is string => m !== null))]

	console.log(`[seed] Inserting ${normalized.length} allowlist entries...`)

	await db
		.insert(chatAllowlist)
		.values(normalized.map((message) => ({ message })))
		.onConflictDoNothing()

	console.log('[seed] Done.')
	process.exit(0)
}

seed().catch((err) => {
	console.error('[seed] Error:', err)
	process.exit(1)
})
