// What a player sees of their own punishments: type, start, end and reason.
// Never the staff member who gave it. Ticket "Appeals" extends each entry with
// an appeal state, keyed by `id`.
import type { BanRecord } from '../../infrastructure/gateways/ban.gateway.js'
import type { WarningRecord } from '../../infrastructure/gateways/warning.gateway.js'

export type PunishmentType = 'warning' | 'chat_ban' | 'queue_ban' | 'account_ban'

// active: in force (a warning is a record that stands). ended: ran out.
// lifted: staff ended it early.
export type PunishmentStatus = 'active' | 'ended' | 'lifted'

export interface PlayerPunishment {
	id: string
	type: PunishmentType
	startsAt: string
	endsAt: string | null
	permanent: boolean
	status: PunishmentStatus
	reason: string
}

const BAN_TYPE: Readonly<Record<BanRecord['banType'], PunishmentType>> = {
	chat: 'chat_ban',
	queue: 'queue_ban',
	account: 'account_ban',
}

function fromBan(ban: BanRecord, now: Date): PlayerPunishment {
	const ended = ban.expiresAt !== null && ban.expiresAt <= now
	return {
		id: ban.id,
		type: BAN_TYPE[ban.banType],
		startsAt: ban.issuedAt.toISOString(),
		endsAt: ban.expiresAt?.toISOString() ?? null,
		permanent: ban.expiresAt === null,
		status: ban.liftedAt ? 'lifted' : ended ? 'ended' : 'active',
		reason: ban.reason,
	}
}

function fromWarning(warning: WarningRecord): PlayerPunishment {
	return {
		id: warning.id,
		type: 'warning',
		startsAt: warning.issuedAt.toISOString(),
		endsAt: null,
		permanent: false,
		status: 'active',
		reason: warning.message,
	}
}

export function buildPunishmentList(
	bans: readonly BanRecord[],
	warnings: readonly WarningRecord[],
	now: Date,
): PlayerPunishment[] {
	return [...bans.map((b) => fromBan(b, now)), ...warnings.map(fromWarning)].sort(
		(a, b) => b.startsAt.localeCompare(a.startsAt),
	)
}
