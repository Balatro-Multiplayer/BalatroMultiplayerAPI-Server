// Who may queue: the server switches (ranked/casual queues, testing mode)
// queue bans (moderation/access.ts), for ranked launcher integrity
// (integrity.ts), and the account's standing (standing/: its reported mods),
// checked when a ticket is added and again when a group is matched (a ban or
// switch can land in between).
import { readConfig } from '../config'
import { checkRankedReadiness, integrityRefusal, readIntegrity } from '../integrity'
import { INVALID_ARGUMENT, PERMISSION_DENIED, runtimeError } from '../errors'
import { queueRefusal } from '../moderation/access'
import { readBans } from '../moderation/bans'
import { notify, NotifyCode } from '../notify'
import { profileFor } from '../player/profile'
import { standingFor } from '../standing/current'
import {
	PVP_MOD_ID,
	PVP_UPDATE_REQUIRED,
	VERSION_MISMATCH,
	pvpJoinRefused,
	pvpVersionOf,
	versionOutliers,
} from '../standing/pvp_version'
import { readModReport } from '../standing/storage'
import { groupOf } from './group/binding'
import { blocksSoloQueue } from './group/refusal'
import type { RefusedMember } from '../lobby/protocol'
import type { MatchPlan } from './matched'
import { MODE_DISABLED, ticketModeDisabled } from './mode_switch'
import { isStandingRefusal, queueRefusalMessage, refusedMods, standingRefusal, type QueueRefusal } from './queue_refusal'
import { TICKET_QUERY_MESSAGES, ticketQueryRefusal } from './ticket_query'
import { settingsOf, type ServerSettings } from '../server_kind'

// Ranked while integrityEnforced needs a verdict, which also passes any mods
// (a verified account skips the mod check); otherwise the standing must be
// valid.
export function queueRefusalFor(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	userId: string,
	ranked: boolean,
	now: number,
): QueueRefusal | null {
	const config = readConfig(nk)
	const access = queueRefusal(config, profileFor(nk, userId).privileges, readBans(nk, userId), ranked, now)
	if (access) return { code: 'access_denied', message: access }
	if (ranked && integrityRefusal(config, readIntegrity(nk, userId), now)) return { code: 'integrity_required' }
	return standingRefusal(standingFor(nk, settings, userId, now, config))
}

// A PvP player whose reported version is below the one the server referees
// (standing/pvp_version.ts): they never enter a pool. The version is read from
// the stored mod report, never from the ticket.
export function pvpFloorRefusal(nk: nkruntime.Nakama, modId: unknown, userId: string): QueueRefusal | null {
	if (modId !== PVP_MOD_ID) return null
	const report = readModReport(nk, userId)
	return pvpJoinRefused(PVP_MOD_ID, pvpVersionOf(report ? report.mods : [])) ? { code: PVP_UPDATE_REQUIRED } : null
}

function matchmakerAdd(envelope: nkruntime.Envelope): { [key: string]: unknown } {
	return ((envelope.matchmakerAdd || envelope.matchmaker_add) as { [key: string]: unknown } | undefined) || {}
}

function stringProperties(envelope: nkruntime.Envelope): { [key: string]: unknown } {
	const add = matchmakerAdd(envelope)
	return ((add.stringProperties || add.string_properties) as { [key: string]: unknown }) || {}
}

export const IN_GROUP_QUEUE = 'You are queueing with your lobby.'

// registerRtBefore('MatchmakerAdd'): a refused ticket fails with the reason,
// as does one whose query reaches past its own queue (ticket_query.ts).
// A player whose lobby is queueing as a group (matchmaking/group) is queued
// through its party's ticket, not one of their own.
export function beforeMatchmakerAdd(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	envelope: nkruntime.Envelope,
): nkruntime.Envelope {
	if (!ctx.userId) return envelope
	const props = stringProperties(envelope)
	const unpinned = ticketQueryRefusal(matchmakerAdd(envelope).query, props)
	if (unpinned) throw runtimeError(INVALID_ARGUMENT, TICKET_QUERY_MESSAGES[unpinned])
	const ranked = props.kind === 'ranked'
	const refused = queueRefusalFor(nk, settingsOf(ctx), ctx.userId, ranked, Date.now())
	if (refused) throw runtimeError(PERMISSION_DENIED, queueRefusalMessage(refused))
	// The update message comes first: a 1.0.x client cannot read mode_disabled.
	const tooOld = pvpFloorRefusal(nk, props.modId, ctx.userId)
	if (tooOld) throw runtimeError(PERMISSION_DENIED, queueRefusalMessage(tooOld))
	if (ticketModeDisabled(readConfig(nk, logger).disabledPvpModes, props.modId, props.mode, ranked))
		throw runtimeError(PERMISSION_DENIED, MODE_DISABLED)
	const group = groupOf(nk, ctx.userId)
	if (group && blocksSoloQueue(group.phase)) throw runtimeError(PERMISSION_DENIED, IN_GROUP_QUEUE)
	if (ranked && readConfig(nk).integrityEnforced) checkRankedReadiness(ctx, logger, nk, ctx.userId)
	return envelope
}

export interface RefusedPlayer {
	userId: string
	refusal: QueueRefusal
}

// A group's refused member, as its home lobby tells its players (op 112 idle).
export function refusedMemberOf(player: RefusedPlayer): RefusedMember {
	return { userId: player.userId, reason: player.refusal.code, mods: refusedMods(player.refusal) }
}

// The players off the PvP version most of them run, by the stored mod reports.
export function pvpVersionOutliers(nk: nkruntime.Nakama, userIds: string[]): string[] {
	const versions: { [userId: string]: string } = {}
	for (const userId of userIds) {
		const report = readModReport(nk, userId)
		versions[userId] = pvpVersionOf(report ? report.mods : [])
	}
	return versionOutliers(versions)
}

// The matched players who may no longer queue, and why. In a PvP match, the
// players who are not on the PvP version most of them run are refused too:
// they are told, the others queue again. The versions come from the stored
// mod reports, so a modified client cannot change them in its ticket.
export function refusedPlayers(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	plan: MatchPlan,
	logger?: nkruntime.Logger,
): RefusedPlayer[] {
	const now = Date.now()
	const ranked = plan.rankedMode !== ''
	// The switch may have flipped since the tickets were added.
	const modeOff = ticketModeDisabled(
		readConfig(nk, logger).disabledPvpModes,
		plan.modId,
		ranked ? plan.rankedMode : plan.gameMode,
		ranked,
	)
	const out: RefusedPlayer[] = []
	for (const userId of plan.playerIds) {
		const refusal: QueueRefusal | null = modeOff ? { code: MODE_DISABLED } : queueRefusalFor(nk, settings, userId, ranked, now)
		if (refusal) out.push({ userId, refusal })
	}
	if (plan.modId === PVP_MOD_ID) {
		for (const userId of pvpVersionOutliers(nk, plan.playerIds)) {
			if (out.every((r) => r.userId !== userId)) out.push({ userId, refusal: { code: VERSION_MISMATCH } })
		}
	}
	return out
}

// Tells a solo player their ticket is gone because their standing no longer
// lets them queue ({modId, mode} name the queue as the client does). reason
// stays the displayable text, as on every QUEUE_CANCELLED; code and mods say
// why in a form the client can render itself.
export function cancelSoloQueue(nk: nkruntime.Nakama, userId: string, modId: string, mode: string, refusal: QueueRefusal) {
	notify(nk, userId, NotifyCode.QUEUE_CANCELLED, 'queue_cancelled', {
		modId,
		mode,
		reason: queueRefusalMessage(refusal),
		code: refusal.code,
		mods: refusedMods(refusal),
		requeue: false,
	})
}

// A refused match spent everyone's ticket, so the solo players still allowed
// to are told to queue again, and a solo refused for their standing is told
// why. A group's members hear it from their lobby instead (matched.ts).
export function requeueSolos(nk: nkruntime.Nakama, plan: MatchPlan, refused: RefusedPlayer[]) {
	const mode = plan.rankedMode !== '' ? plan.rankedMode : plan.gameMode
	const grouped = plan.groups.reduce((ids: string[], g) => ids.concat(g.memberIds), [])
	for (const id of plan.playerIds) {
		if (grouped.indexOf(id) !== -1) continue
		const own = refused.filter((r) => r.userId === id)[0]
		if (own) {
			if (isStandingRefusal(own.refusal) || own.refusal.code === VERSION_MISMATCH || own.refusal.code === MODE_DISABLED)
				cancelSoloQueue(nk, id, plan.modId, mode, own.refusal)
			continue
		}
		notify(nk, id, NotifyCode.QUEUE_CANCELLED, 'queue_cancelled', {
			modId: plan.modId,
			mode,
			reason: 'A matched player can no longer play',
			requeue: true,
		})
	}
}

// When any matched player may no longer queue, the match is refused and the
// others are told to queue again.
export function refuseMatchedGroup(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	logger: nkruntime.Logger,
	plan: MatchPlan,
): boolean {
	const refused = refusedPlayers(nk, settings, plan, logger)
	if (refused.length === 0) return false
	requeueSolos(nk, plan, refused)
	logger.warn('Matched group refused: %d player(s) may not queue', refused.length)
	return true
}
