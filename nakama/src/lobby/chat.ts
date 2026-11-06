// Lobby chat rules as pure functions over the lobby (see state.ts): who may
// talk, how fast, and what the moderation service is shown as context. The
// moderation call itself happens in the chat_send RPC, not the match loop.
import { type ChatLine, type Lobby, type Step, findPlayer } from './state'
import { ServerOp } from './protocol'

// Token bucket per sender, kept in the lobby's action budget under its own key.
export const CHAT_BURST = 5
export const CHAT_REFILL_MS = 1000
// How many earlier lines the moderation service sees.
export const CHAT_CONTEXT_LINES = 8
export const CHAT_TAIL = 20

export type ChatCheck =
	| { ok: true; lobby: Lobby; displayName: string; context: { who: 'sender' | 'other'; text: string }[] }
	| { ok: false; reason: 'not_in_lobby' | 'rate_limited' }

export function chatBudgetKey(userId: string): string {
	return 'chat:' + userId
}

export function chatCheck(lobby: Lobby, userId: string, now: number): ChatCheck {
	const player = findPlayer(lobby, userId)
	if (!player || lobby.closed) return { ok: false, reason: 'not_in_lobby' }
	const key = chatBudgetKey(userId)
	const bucket = lobby.actionBudget[key] || { tokens: CHAT_BURST, at: now }
	const tokens = Math.min(CHAT_BURST, bucket.tokens + (now - bucket.at) / CHAT_REFILL_MS)
	if (tokens < 1) return { ok: false, reason: 'rate_limited' }
	const next = {
		...lobby,
		actionBudget: { ...lobby.actionBudget, [key]: { tokens: tokens - 1, at: now } },
	}
	const context = (lobby.chat || []).slice(-CHAT_CONTEXT_LINES).map((line) => ({
		who: (line.senderId === userId ? 'sender' : 'other') as 'sender' | 'other',
		text: line.text,
	}))
	return { ok: true, lobby: next, displayName: player.info.displayName, context }
}

// Delivers an approved line to everyone seated (the sender too: the client
// shows chat from the same stream for every player) and keeps it as context.
export function chatPost(lobby: Lobby, userId: string, text: string, now: number): Step {
	const player = findPlayer(lobby, userId)
	if (!player || lobby.closed) return { lobby, out: [] }
	const line: ChatLine = { senderId: userId, text, displayName: player.info.displayName, at: now }
	const chat = (lobby.chat || []).concat([line]).slice(-CHAT_TAIL)
	return {
		lobby: { ...lobby, chat },
		out: [
			{
				kind: 'send',
				op: ServerOp.CHAT,
				payload: { senderId: userId, displayName: player.info.displayName, message: text },
				to: lobby.players.map((p) => p.id),
			},
		],
	}
}

// The sender id of a tournament organiser's line (they aren't seated).
export const ORGANISER_SENDER = 'tournament_organiser'

// A tournament organiser's message: to everyone seated, shown as from
// "[Organiser] <name>", and kept as context like any line.
export function organiserPost(lobby: Lobby, name: string, text: string, now: number): Step {
	if (lobby.closed) return { lobby, out: [] }
	const displayName = '[Organiser] ' + name
	const line: ChatLine = { senderId: ORGANISER_SENDER, text, displayName, at: now }
	const chat = (lobby.chat || []).concat([line]).slice(-CHAT_TAIL)
	return {
		lobby: { ...lobby, chat },
		out: [
			{
				kind: 'send',
				op: ServerOp.CHAT,
				payload: { senderId: ORGANISER_SENDER, displayName, message: text },
				to: lobby.players.map((p) => p.id),
			},
		],
	}
}

// What a report filed from this lobby carries: where it was filed, the game it
// is about (the running one, else the last one) and the chat tail.
export interface ReportEvidence {
	code: string
	runId: string | null
	chat: { playerId: string; displayName: string; message: string; sentAt: number }[]
}

export type EvidenceCheck =
	| { ok: true; evidence: ReportEvidence }
	| { ok: false; reason: 'not_in_lobby' | 'unknown_player' | 'self' }

// The reporter must be seated; the reported player seated, or a participant
// of the running game (they may have left it).
export function reportEvidence(lobby: Lobby, reporterId: string, reportedId: string): EvidenceCheck {
	if (!findPlayer(lobby, reporterId) || lobby.closed) return { ok: false, reason: 'not_in_lobby' }
	if (reporterId === reportedId) return { ok: false, reason: 'self' }
	const started = lobby.game.started
	const known =
		!!findPlayer(lobby, reportedId) ||
		(!!started && started.players.some((p) => p.id === reportedId))
	if (!known) return { ok: false, reason: 'unknown_player' }
	return {
		ok: true,
		evidence: {
			code: lobby.code,
			runId: started ? started.runId : lobby.lastRunId || null,
			chat: (lobby.chat || [])
				.filter((line) => line.at !== undefined)
				.map((line) => ({
					playerId: line.senderId,
					displayName: line.displayName || '',
					message: line.text,
					sentAt: line.at as number,
				})),
		},
	}
}
