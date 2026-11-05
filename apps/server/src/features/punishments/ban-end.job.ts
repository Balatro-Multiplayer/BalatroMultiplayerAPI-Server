import {
	listDecidedAppealsToTell,
	markAppealNotified,
	findPunishmentRef,
} from '../../infrastructure/gateways/appeal.gateway.js'
import {
	listEndedBansToTell,
	markBanEndNotified,
} from '../../infrastructure/gateways/ban.gateway.js'
import {
	notifyAppealDecidedInNakama,
	notifyBanEndedInNakama,
} from '../../infrastructure/nakama/moderation-sync.js'

// Tells each player their chat, queue or account ban ended: it ran out, or an
// admin lifted it early. A ban stays on the list until Nakama confirms, so each
// run retries it; Nakama sends once per ban, so a retry never doubles. A lifted
// ban is told on the next run, and its old end time passing changes nothing.
// A ban lifted by an appeal is marked told with the appeal, so it is not here.

export const BAN_END_CHECK_INTERVAL_MS = 5 * 60 * 1000

export async function tellEndedBans(): Promise<number> {
	let told = 0
	for (const ban of await listEndedBansToTell()) {
		// Nakama is down or unreachable: stop, the next run tries again.
		if (!(await notifyBanEndedInNakama(ban))) return told
		await markBanEndNotified(ban.id)
		told++
	}
	return told
}

// Retries the decision Notification of every appeal decided but not yet
// confirmed (the call right after the decision failed). Nakama sends once per
// appeal, so a retry never doubles.
export async function tellDecidedAppeals(): Promise<number> {
	let told = 0
	for (const appeal of await listDecidedAppealsToTell()) {
		const punishment = appeal.punishmentId ? await findPunishmentRef(appeal.punishmentId) : null
		const target = punishment ? (punishment.banType ?? 'warning') : 'network'
		const sent = await notifyAppealDecidedInNakama({
			playerId: appeal.playerId,
			appealId: appeal.id,
			accepted: appeal.status === 'granted',
			target,
			result: appeal.status === 'granted' ? appeal.outcome : null,
		})
		if (!sent) return told
		await markAppealNotified(appeal.id)
		told++
	}
	return told
}

export function startBanEndJob(): () => void {
	const check = () =>
		void Promise.all([tellEndedBans(), tellDecidedAppeals()]).catch((err) =>
			console.error('[bans] ban end Notification failed:', err),
		)
	check()
	const timer = setInterval(check, BAN_END_CHECK_INTERVAL_MS)
	timer.unref()
	return () => clearInterval(timer)
}
