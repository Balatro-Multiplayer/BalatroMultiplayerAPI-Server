import { db } from '../../infrastructure/db/index.js'
import { insertStrike } from '../../infrastructure/gateways/strike.gateway.js'
import type { AppliedStep, Ladder, LadderStep } from '../strikes/ladder.js'
import {
	type BanRecord,
	type BanType,
	insertBan,
} from '../../infrastructure/gateways/ban.gateway.js'
import { banInNakama } from '../../infrastructure/nakama/moderation-sync.js'

export interface IssueBanParams {
	playerId: string
	banType: BanType
	expiresAt: Date | null
	reason: string
	issuedBy: string
	// Set for a punishment that counts on a strike ladder (an account ban has none).
	strike?: {
		ladder: Ladder
		recommendedStep: LadderStep
		appliedStep: AppliedStep
		deviationReason: string | null
	}
}

/**
 * Extracted from the original POST /players/:id/bans handler so the
 * service-queue "Ban" action (features/service-queue/dispatcher.ts) can reuse the exact
 * same side-effect sequence instead of duplicating it.
 *
 * §21.3: account and queue bans take effect immediately. Postgres keeps the
 * ban history; Nakama enforces it at once (nakama/src/admin.ts): an account
 * ban closes the player's session and forfeits their match, a queue ban
 * pulls them out of matchmaking. A player Nakama doesn't know yet is caught
 * by the player sync at their next login.
 */
export async function issueBan(params: IssueBanParams): Promise<BanRecord> {
	const row = {
		playerId: params.playerId,
		banType: params.banType,
		expiresAt: params.expiresAt,
		issuedBy: params.issuedBy,
		reason: params.reason,
	}
	const { strike } = params
	const ban = strike
		? await db.transaction(async (tx) => {
				const inserted = await insertBan(row, tx)
				await insertStrike(tx, {
					playerId: params.playerId,
					banId: inserted.id,
					warningId: null,
					issuedAt: inserted.issuedAt,
					...strike,
				})
				return inserted
			})
		: await insertBan(row)

	await banInNakama(ban).catch((e) =>
		console.error('[ban.service] Nakama ban failed:', e),
	)

	return ban
}
