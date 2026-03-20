import { Router } from 'express'
import { env } from '../env.js'
import { AppError } from '../utils/errors.js'
import { getConfig, loadConfigFromDb } from '../state/config.js'
import { mqttService } from '../services/mqtt.service.js'

const router = Router()

router.post('/refresh-config', async (req, res, next) => {
	try {
		const secret = req.headers['x-admin-secret']
		if (secret !== env.ADMIN_SECRET) {
			throw new AppError('Unauthorized', 401)
		}

		const previousMods = getConfig().mods

		const newConfig = await loadConfigFromDb()

		const changedMods = newConfig.mods.filter((newMod) => {
			const prev = previousMods.find((m) => m.modId === newMod.modId)
			return !prev || prev.version !== newMod.version
		})

		if (changedMods.length > 0) {
			await mqttService.publishModUpdate(changedMods)
			console.log(
				`[admin] Mod update broadcast: ${changedMods.map((m) => `${m.modId}@${m.version}`).join(', ')}`,
			)
		}

		res.json(newConfig)
	} catch (err) {
		next(err)
	}
})

export default router
