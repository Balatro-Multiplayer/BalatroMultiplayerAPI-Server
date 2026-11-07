// Lobby chat RPCs. Sending goes through an RPC, not a match op, because the
// moderation service is an HTTP call and the match loop must never wait on one:
// the match is asked to check the sender (chat_check), the message is moderated
// here, then the match is told to post it (chat_post).
import {
	INVALID_ARGUMENT,
	PERMISSION_DENIED,
	UNAVAILABLE,
	runtimeError,
} from '../errors'
import { NOTICE_VERSION } from '../../../packages/types/src/notice'
import { readConfig } from '../config'
import { chatBanRefusal } from '../moderation/access'
import { readBans } from '../moderation/bans'
import { currentLobby } from '../lobby/rpc'
import { playerView, profileFor, updateProfile, type Profile } from '../player/profile'
import { parsePayload, requireUser } from '../rpc'
import { type LobbySignal, lobbyIdOf } from '../lobby/protocol'
import {
	type GuardResult,
	MAX_MESSAGE_LENGTH,
	REVIEW_BAND,
	callModeration,
	decideModerationOutcome,
} from './moderation'
import { isAllowlisted, obscenityMatches } from './filter'
import { settingsOf, type ServerSettings } from '../server_kind'
import { type ChatLogLine, type ChatVerdict, enqueue } from '../mirror/outbox'
import { lobbyKindOfLabel } from '../review/ranked'

// What the player must still give before chatting: the Notice on a kind
// that requires it, otherwise the age answer (asked once on every kind).
type MissingConsent = 'notice' | 'age'

const MISSING_CONSENT_MESSAGE: { readonly [K in MissingConsent]: string } = {
	notice: 'Accept the Notice first',
	age: 'Answer the age question first',
}

// null once cleared.
function consentMissing(profile: Profile, settings: ServerSettings): MissingConsent | null {
	if (settings.noticeRequired) return profile.tosAcceptedVersion >= NOTICE_VERSION ? null : 'notice'
	return profile.ageAnswered ? null : 'age'
}

// {} -> {enabled, player}: turns chat on for the caller (the API's
// /auth/chat/enable). Refused for a chat-blocked account (the age check at
// ToS time) and before the current ToS is accepted.
export function rpcChatEnable(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const settings = settingsOf(ctx)
	const profile = updateProfile(
		nk,
		userId,
		(current) => {
			if (current.chatBlocked) throw runtimeError(PERMISSION_DENIED, 'Chat access is permanently restricted')
			const missing = consentMissing(current, settings)
			if (missing) throw runtimeError(PERMISSION_DENIED, MISSING_CONSENT_MESSAGE[missing])
			return { ...current, chatEnabled: true }
		},
		ctx.username,
	)
	return JSON.stringify({ enabled: true, player: playerView(userId, profile) })
}

// {message} -> {} once it has been posted to the caller's lobby, or an error:
// PERMISSION_DENIED for a message moderation blocked (or chat not enabled),
// UNAVAILABLE when it cannot be judged (fails closed). A message on the
// allowlist skips moderation; with the service switched off (MODERATION_REMOTE
// =off, the Community and Dev default) the local word filter judges instead.
export function rpcChatSend(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const message = parsePayload(payload).message
	if (typeof message !== 'string' || !message.trim())
		throw runtimeError(INVALID_ARGUMENT, 'Message is empty')
	if (message.length > MAX_MESSAGE_LENGTH)
		throw runtimeError(INVALID_ARGUMENT, `Message is over ${MAX_MESSAGE_LENGTH} characters`)
	const config = readConfig(nk)
	if (!config.chatEnabled) throw runtimeError(UNAVAILABLE, 'Chat is turned off')
	const profile = profileFor(nk, userId, ctx.username)
	if (profile.chatBlocked || !profile.chatEnabled)
		throw runtimeError(PERMISSION_DENIED, 'Chat is not enabled for this account')
	const missing = consentMissing(profile, settingsOf(ctx))
	if (missing) throw runtimeError(PERMISSION_DENIED, MISSING_CONSENT_MESSAGE[missing])
	const banned = chatBanRefusal(readBans(nk, userId), Date.now())
	if (banned) throw runtimeError(PERMISSION_DENIED, banned)

	const current = currentLobby(nk, userId)
	if (!current) throw runtimeError(INVALID_ARGUMENT, 'Not in a lobby')

	const check = JSON.parse(
		nk.matchSignal(current.matchId, JSON.stringify({ type: 'chat_check', userId } as LobbySignal)),
	)
	if (check.error === 'rate_limited') throw runtimeError(UNAVAILABLE, 'You are sending messages too fast')
	if (check.error) throw runtimeError(INVALID_ARGUMENT, 'Not in a lobby')
	const match = nk.matchGet(current.matchId)
	const lobby = {
		lobbyCode: check.code as string,
		lobbyId: lobbyIdOf(current.matchId),
		lobbyKind: lobbyKindOfLabel(match ? match.label : null),
	}

	let flagged = false
	let verdict: ChatVerdict | null = null
	if (!isAllowlisted(message, config.chatAllowlist)) {
		if (settingsOf(ctx).moderationRemote) {
			const outcome = decideModerationOutcome(
				callModeration(nk, logger, ctx.env, {
					playerId: userId,
					lobbyCode: check.code,
					message,
					context: check.context,
				}),
			)
			if (!outcome.allowed) {
				if (outcome.reason === 'moderated') {
					// The service keeps no message content, so this is the only
					// record of what was blocked.
					logChat(nk, logger, lobby, userId, message, true, {
						source: 'remote',
						band: outcome.band || 'unknown',
						...guardFields(outcome.guard),
					})
					throw runtimeError(PERMISSION_DENIED, 'Message blocked by moderation')
				}
				throw runtimeError(UNAVAILABLE, 'Chat is unavailable right now')
			}
			// Published. A review message is flagged so a moderator sees it. Any
			// message the guard judged keeps its score.
			flagged = outcome.review
			if (outcome.review) verdict = { source: 'remote', band: REVIEW_BAND, ...guardFields(outcome.guard) }
			else if (outcome.guard) verdict = { source: 'remote', band: outcome.band || 'unknown', ...guardFields(outcome.guard) }
		} else {
			const matches = obscenityMatches(message)
			if (matches.length > 0) {
				logChat(nk, logger, lobby, userId, message, true, { source: 'local', matches })
				throw runtimeError(PERMISSION_DENIED, 'Message blocked by moderation')
			}
		}
	}

	nk.matchSignal(
		current.matchId,
		JSON.stringify({ type: 'chat_post', userId, text: message } as LobbySignal),
	)
	logChat(nk, logger, lobby, userId, message, flagged, verdict)
	return JSON.stringify({ text: message })
}

function guardFields(guard: GuardResult | undefined) {
	return guard ? { guardSafety: guard.safety, guardScore: guard.score, guardContextUsed: guard.contextUsed } : {}
}

// Queues a chat line for the API's chat log (mirror/outbox.ts). A flagged line
// (blocked, or published for review) carries why. Never fails the send: losing a log line beats losing the chat.
function logChat(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	lobby: Pick<ChatLogLine, 'lobbyCode' | 'lobbyId' | 'lobbyKind'>,
	userId: string,
	message: string,
	flagged: boolean,
	verdict: ChatVerdict | null,
) {
	try {
		enqueue(nk, {
			kind: 'chat',
			at: Date.now(),
			line: { ...lobby, userId, message, flagged, verdict },
		})
	} catch (e) {
		logger.error('Could not queue a chat line for the API: %v', e)
	}
}
