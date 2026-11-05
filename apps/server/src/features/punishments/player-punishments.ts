// What a player sees of their own punishments: type, start, end and reason,
// and the state of their appeal. Never the staff member who gave it.
import type { BanRecord } from '../../infrastructure/gateways/ban.gateway.js'
import type { WarningRecord } from '../../infrastructure/gateways/warning.gateway.js'
import { type AppealFacts, APPEAL_COOLDOWN_MS, canSubmitAppeal } from '../appeals/appeal-rules.js'
import type { AppealRow } from '../appeals/appeals.service.js'

export type PunishmentType = 'warning' | 'chat_ban' | 'queue_ban' | 'account_ban' | 'username_ban'

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
	// The latest appeal of this punishment, and whether another may be made now.
	appeal: AppealView | null
	canAppeal: boolean
	// When a denied appeal's wait ends (null when none is running).
	appealAvailableAt: string | null
}

// The player's view of an appeal: its status and the reason for the decision.
export interface AppealView {
	status: AppealRow['status']
	reason: string | null
	createdAt: string
	decidedAt: string | null
}

export interface AppealState {
	appeal: AppealView | null
	canAppeal: boolean
	appealAvailableAt: string | null
}

// The state of one target's appeals (a punishment's, or the network ban's), newest first or not.
export function appealStateOf(history: readonly AppealRow[], now: Date): AppealState {
	const latest = [...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
	const facts: AppealFacts[] = history.map((a) => ({ status: a.status, decidedAt: a.decidedAt }))
	const check = canSubmitAppeal(facts, now)
	const lastDenial = history.flatMap((a) => (a.status === 'denied' && a.decidedAt ? [a.decidedAt.getTime()] : []))
	const waiting = !check.ok && check.refusal.code === 'cooling_down'
	return {
		appeal: latest
			? {
					status: latest.status,
					reason: latest.decisionReason,
					createdAt: latest.createdAt.toISOString(),
					decidedAt: latest.decidedAt?.toISOString() ?? null,
				}
			: null,
		canAppeal: check.ok,
		appealAvailableAt:
			waiting && lastDenial.length > 0 ? new Date(Math.max(...lastDenial) + APPEAL_COOLDOWN_MS).toISOString() : null,
	}
}

const BAN_TYPE: Readonly<Record<BanRecord['banType'], PunishmentType>> = {
	chat: 'chat_ban',
	queue: 'queue_ban',
	account: 'account_ban',
	username: 'username_ban',
}

type Plain = Omit<PlayerPunishment, keyof AppealState>

function fromBan(ban: BanRecord, now: Date): Plain {
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

function fromWarning(warning: WarningRecord): Plain {
	return {
		id: warning.id,
		type: 'warning',
		startsAt: warning.issuedAt.toISOString(),
		endsAt: null,
		permanent: false,
		status: warning.liftedAt ? 'lifted' : 'active',
		reason: warning.message,
	}
}

export function buildPunishmentList(
	bans: readonly BanRecord[],
	warnings: readonly WarningRecord[],
	now: Date,
	appeals: readonly AppealRow[] = [],
): PlayerPunishment[] {
	return [...bans.map((b) => fromBan(b, now)), ...warnings.map(fromWarning)]
		.map((p) => {
			const state = appealStateOf(
				appeals.filter((a) => a.punishmentId === p.id),
				now,
			)
			// A lifted punishment has nothing left to appeal.
			return { ...p, ...state, canAppeal: state.canAppeal && p.status !== 'lifted' }
		})
		.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
}
