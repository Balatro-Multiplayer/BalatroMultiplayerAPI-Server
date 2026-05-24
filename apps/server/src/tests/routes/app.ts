import express from 'express'
import router from '../../routes/index.js'
import { errorHandler } from '../../middleware/errorHandler.js'

export function createTestApp() {
	const app = express()
	app.use(express.json())
	app.get('/health', (_req, res) => {
		res.json({ status: 'ok' })
	})
	app.use(router)
	app.use(errorHandler)
	return app
}
