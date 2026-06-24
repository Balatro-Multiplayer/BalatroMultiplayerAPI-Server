import { Router } from 'express'
import { AppError } from '../../shared/utils/errors.js'
import { parseExpiresAt } from '../../shared/utils/parse-expires-at.js'
import { getConfig } from '../../state/config.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { insertBan, isBanType, liftBan, listBans } from '../../infrastructure/gateways/ban.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { kickClient } from '../../infrastructure/emqx/emqx-admin.service.js'
import { getSession } from '../../state/index.js'

const router = Router()

router.post('/players/:id/bans', async (req, res, next) => {
	try {
		const playerId = req.params.id
		const { type, expiresAt, reason } = req.body as {
			type?: unknown
			expiresAt?: unknown
			reason?: unknown
		}

		if (!isBanType(type)) {
			throw new AppError("type must be 'chat', 'queue', or 'account'", 400)
		}
		if (reason !== undefined && typeof reason !== 'string') {
			throw new AppError('reason must be a string', 400)
		}
		const parsedExpiresAt = parseExpiresAt(expiresAt)

		const player = await findPlayerById(playerId)
		if (!player) throw new AppError('Player not found', 404)

		const ban = await insertBan({
			playerId,
			banType: type,
			expiresAt: parsedExpiresAt,
			issuedBy: 'admin',
			reason: typeof reason === 'string' ? reason : '',
		})

		// Account bans take effect immediately: if the player is currently
		// connected, notify and force-disconnect them. The disconnect webhook
		// then runs the normal grace-period / lobby cleanup. Offline players are
		// caught by the EMQX auth webhook on their next CONNECT.
		if (type === 'account' && getSession(playerId)) {
			await mqttService
				.publishToPlayer(playerId, 'notifications', {
					type: 'banned',
					banType: 'account',
					reason: ban.reason,
				})
				.catch((err) =>
					console.error('[admin] ban notify failed:', err),
				)
			await kickClient(playerId)
		}

		console.log(
			`[admin] Issued ${type} ban on ${playerId} (expires ${parsedExpiresAt?.toISOString() ?? 'never'})`,
		)
		res.status(201).json({ ban })
	} catch (err) {
		next(err)
	}
})

router.delete('/players/:id/bans/:banId', async (req, res, next) => {
	try {
		const lifted = await liftBan(req.params.id, req.params.banId, 'admin')
		if (!lifted) {
			throw new AppError('No matching active ban found', 404)
		}

		console.log(`[admin] Lifted ban ${req.params.banId} on ${req.params.id}`)
		res.json({ ban: lifted })
	} catch (err) {
		next(err)
	}
})

router.get('/players/:id/bans', async (req, res, next) => {
	try {
		const bans = await listBans(req.params.id)
		res.json({ bans })
	} catch (err) {
		next(err)
	}
})

export default router
