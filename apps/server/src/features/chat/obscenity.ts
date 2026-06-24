import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { insertFlaggedMessage } from '../../infrastructure/gateways/chat.gateway.js'

type MatchRecord = {
	word: string
	startIndex: number
	endIndex: number
}

const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
})

export async function moderateMessage(
	message: string,
	playerId: string,
): Promise<{ allowed: boolean }> {
	const raw = matcher.getAllMatches(message)
	if (raw.length === 0) return { allowed: true }

	const matches: MatchRecord[] = raw.map((m) => ({
		word: englishDataset.getPayloadWithPhraseMetadata(m).phraseMetadata?.originalWord ?? '',
		startIndex: m.startIndex,
		endIndex: m.endIndex,
	}))

	await insertFlaggedMessage(playerId, message, matches)

	return { allowed: false }
}
