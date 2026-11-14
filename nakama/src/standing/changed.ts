// The allowlist changed (admin_config_set), so standings
// may have: every online player who reported this session hears their new
// one (STANDING_CHANGED), their lobby's snapshot follows, and a queued ticket
// whose player may no longer queue is cancelled -- a solo's by telling them
// (the JS runtime can't remove a ticket), a group's through its home lobby.
import { readConfig } from '../config'
import { queueRefusalFor, cancelSoloQueue, refusedMemberOf } from '../matchmaking/gate'
import { cancelGroupFor } from '../matchmaking/group/matched'
import { groupOf } from '../matchmaking/group/binding'
import { clearMatched, liveQueuedPlayers } from '../matchmaking/queue'
import { isStandingRefusal } from '../matchmaking/queue_refusal'
import { notify, NotifyCode } from '../notify'
import { pushToLobby } from '../player/rpc'
import { standingFor } from './current'
import { reporterIds } from './storage'
import type { ServerSettings } from '../server_kind'

const NOTIFICATIONS_STREAM = 0
const RANKED_PREFIX = 'ranked:'

function isOnline(nk: nkruntime.Nakama, userId: string): boolean {
	return nk.streamUserList({ mode: NOTIFICATIONS_STREAM, subject: userId }, true, true).length > 0
}

export function announceStandings(nk: nkruntime.Nakama, logger: nkruntime.Logger, settings: ServerSettings, now: number): number {
	const config = readConfig(nk)
	let told = 0
	for (const userId of reporterIds(nk)) {
		if (!isOnline(nk, userId)) continue
		const view = standingFor(nk, settings, userId, now, config)
		notify(nk, userId, NotifyCode.STANDING_CHANGED, 'standing_changed', { ...view })
		pushToLobby(nk, logger, userId, { standing: view.standing })
		told++
	}
	return told
}

// Cancels the queued tickets whose player's standing no longer lets them
// queue: { solos, groups } cancelled.
export function regateQueued(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	now: number,
): { solos: number; groups: number } {
	const cancelledParties: string[] = []
	let solos = 0
	for (const queued of liveQueuedPlayers(nk, null, now)) {
		const { userId, record } = queued
		const group = groupOf(nk, userId)
		if (group && group.phase === 'queued') {
			if (cancelledParties.indexOf(group.partyId) !== -1) continue
			const refusal = queueRefusalFor(nk, settings, userId, false, now)
			if (!refusal || !isStandingRefusal(refusal)) continue
			cancelGroupFor(nk, group.homeCode, group.partyId, 'member_refused', refusedMemberOf({ userId, refusal }))
			cancelledParties.push(group.partyId)
			continue
		}
		const ranked = record.gameMode.indexOf(RANKED_PREFIX) === 0
		const refusal = queueRefusalFor(nk, settings, userId, ranked, now)
		if (!refusal || !isStandingRefusal(refusal)) continue
		const mode = ranked ? record.gameMode.slice(RANKED_PREFIX.length) : record.gameMode
		cancelSoloQueue(nk, userId, record.modId, mode, refusal)
		clearMatched(nk, record.modId, record.gameMode, [userId])
		solos++
	}
	return { solos, groups: cancelledParties.length }
}

export function standingInputsUpdated(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	logger: nkruntime.Logger,
	now: number,
) {
	const told = announceStandings(nk, logger, settings, now)
	const cancelled = regateQueued(nk, settings, now)
	logger.info(
		'Standing inputs changed: told %d player(s); cancelled %d solo ticket(s), %d group(s)',
		told,
		cancelled.solos,
		cancelled.groups,
	)
}
