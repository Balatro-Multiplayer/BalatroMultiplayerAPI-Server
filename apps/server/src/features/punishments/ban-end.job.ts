import {
	listEndedBansToTell,
	markBanEndNotified,
} from '../../infrastructure/gateways/ban.gateway.js'
import { notifyBanEndedInNakama } from '../../infrastructure/nakama/moderation-sync.js'

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

export function startBanEndJob(): () => void {
	const check = () =>
		void tellEndedBans().catch((err) =>
			console.error('[bans] ban end Notification failed:', err),
		)
	check()
	const timer = setInterval(check, BAN_END_CHECK_INTERVAL_MS)
	timer.unref()
	return () => clearInterval(timer)
}
