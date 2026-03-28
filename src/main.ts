import express from 'express'
import type { Express, Request, Response } from 'express'
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

app.get('/health', (_req: Request, res: Response) => {
	res.json({ status: 'ok' })
})

app.use(router)

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

type PrivateModule = { registerPrivate: (app: Express) => Promise<void> }

async function start() {
	try {
		await loadConfigFromDb()

		// Load private features if available (not present in public builds)
		const privatePath: string = '@v-rtualized/bmp-internal'
		try {
			const { registerPrivate } = await import(privatePath) as PrivateModule
			await registerPrivate(app)
		} catch {
			// running without private features
		}

		app.use(errorHandler)

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
