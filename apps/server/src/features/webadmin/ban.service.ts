import { insertBan, type BanRecord, type BanType } from '../../infrastructure/gateways/ban.gateway.js'
import { kickClient } from '../../infrastructure/emqx/emqx-admin.service.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { getSession } from '../../state/index.js'

export interface IssueBanParams {
	playerId: string
	banType: BanType
	expiresAt: Date | null
	reason: string
	issuedBy: string
}

/**
 * Extracted from the original POST /players/:id/bans handler so the
 * service-queue "Ban" action (service-queue-actions.ts) can reuse the exact
 * same side-effect sequence instead of duplicating it.
 *
 * §21.3: account and queue bans take effect immediately. Account bans
 * force-disconnect the player from the platform entirely (offline players
 * are caught by the EMQX auth webhook on their next CONNECT); queue bans
 * leave them connected but pull them out of matchmaking. Either way, if
 * they're currently inside an active match, that's an instant forfeit --
 * not the normal 2-minute disconnect grace period.
 */
export async function issueBan(params: IssueBanParams): Promise<BanRecord> {
	const ban = await insertBan({
		playerId: params.playerId,
		banType: params.banType,
		expiresAt: params.expiresAt,
		issuedBy: params.issuedBy,
		reason: params.reason,
	})

	if (params.banType === 'account' || params.banType === 'queue') {
		if (getSession(params.playerId)) {
			await mqttService
				.publishToPlayer(params.playerId, 'notifications', {
					type: 'banned',
					banType: params.banType,
					reason: ban.reason,
				})
				.catch((e) => console.error('[ban.service] ban notify failed:', e))
		}

		// Dynamically imported from the composition root the same way
		// grace-period.service.ts does, to avoid a static import cycle back
		// through webadmin.route.ts.
		const { matchmakingService } = await import('../../routes/index.js')
		await matchmakingService.forfeitMatchForBan(params.playerId, params.banType)

		if (params.banType === 'account' && getSession(params.playerId)) {
			await kickClient(params.playerId)
		}
	}

	return ban
}
