import express from 'express'
import type { Server } from 'node:http'
import { pool } from './db/index.js'
import { env } from './env.js'
import { errorHandler } from './middleware/errorHandler.js'
import router from './routes/index.js'
import { clearAllGracePeriods } from './services/grace-period.service.js'
import { provisionEmqxWebhook } from './services/emqx-provision.service.js'
import { mqttService } from './services/mqtt.service.js'
import { startSessionCleanup, stopSessionCleanup } from './state/index.js'
import { loadConfigFromDb } from './state/config.js'

const app = express()

app.use(express.json())

app.get('/health', (_req, res) => {
	res.json({ status: 'ok' })
})

app.use(router)

app.use(errorHandler)

let server: Server

async function shutdown() {
	console.log('[server] Shutting down gracefully...')

	stopSessionCleanup()
	clearAllGracePeriods()

	if (server) {
		await new Promise<void>((resolve) => {
			server.close(() => resolve())
		})
		console.log('[server] HTTP server closed')
	}

	await mqttService.disconnect()
	console.log('[server] MQTT disconnected')

	await pool.end()
	console.log('[server] DB pool closed')

	process.exit(0)
}

async function start() {
	try {
		await loadConfigFromDb()
		await mqttService.connect()
		await provisionEmqxWebhook()

		startSessionCleanup()

		server = app.listen(env.PORT, () => {
			console.log(`[server] API server listening on port ${env.PORT}`)
		})

		process.on('SIGTERM', shutdown)
		process.on('SIGINT', shutdown)
	} catch (err) {
		console.error('[server] Failed to start:', err)
		process.exit(1)
	}
}

start()
