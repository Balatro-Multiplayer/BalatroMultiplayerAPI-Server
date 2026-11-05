import type { Server } from 'node:http'
import express from 'express'
import type { Express, Request, Response } from 'express'
import { env } from './env.js'
import { createDevChallengeStrategy } from './features/launcher-integrity/dev-strategy.js'
import { syncModRegistry } from './features/mods/mods-sync.service.js'
import { fillAchievementsAtBoot } from './features/achievements/achievements-backfill.service.js'
import { fillMissingSmodsIds } from './features/mods/smods-ids-backfill.service.js'
import { nakamaIntegrityService } from './features/nakama/integrity.js'
import { startMirrorJob } from './features/nakama/mirror.job.js'
import { startRetentionJob } from './features/nakama/retention.job.js'
import { startRetentionSweepJob } from './features/retention/sweep.job.js'
import { startBanEndJob } from './features/punishments/ban-end.job.js'
import { startSeasonJob } from './features/ratings/season.job.js'
import { db, pool } from './infrastructure/db/index.js'
import { loadConfigFromDb } from './infrastructure/gateways/config.gateway.js'
import { purgeReportedLobbyMessages } from './infrastructure/gateways/moderation-retention.gateway.js'
import {
	pushConfigToNakama,
	setIntegrityEnforced,
} from './infrastructure/nakama/config-sync.js'
import { errorHandler } from './middleware/errorHandler.js'
import router from './routes/index.js'
import type { RegisterPrivateDeps } from './shared/types/index.js'
import type { ChallengeStrategy } from './shared/types/index.js'
import { getConfig } from './state/config.js'
import { startSessionCleanup, stopSessionCleanup } from './state/index.js'

const app = express()

app.set('trust proxy', 1)
app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
	res.json({ status: 'ok' })
})

app.use(router)

let server: Server

const SHUTDOWN_DEADLINE_MS = 8_000

async function shutdownSteps() {
	stopSessionCleanup()
	nakamaIntegrityService.clearAll()

	if (server) {
		await new Promise<void>((resolve) => {
			server.close(() => resolve())
		})
		console.log('[server] HTTP server closed')
	}

	await pool.end()
	console.log('[server] DB pool closed')
}

// A hang in any one step (e.g. pool.end() blocked on a stuck query) used to
// mean a graceful shutdown never completed and the orchestrator eventually
// had to SIGKILL with no further logging. Race against a deadline instead so
// a stuck step is at least visible and doesn't block the process from
// exiting.
async function shutdown() {
	console.log('[server] Shutting down gracefully...')

	const timeout = new Promise<'timeout'>((resolve) =>
		setTimeout(() => resolve('timeout'), SHUTDOWN_DEADLINE_MS),
	)

	const result = await Promise.race([
		shutdownSteps().then(() => 'done' as const),
		timeout,
	])
	if (result === 'timeout') {
		console.error(
			`[server] Shutdown did not complete within ${SHUTDOWN_DEADLINE_MS}ms, exiting anyway`,
		)
	}

	process.exit(0)
}

async function purgeReportedLobbyMessagesJob() {
	try {
		await purgeReportedLobbyMessages()
	} catch (err) {
		console.error('[cleanup] Failed to purge reported lobby messages:', err)
	}
}


type PrivateModule = {
	registerPrivate: (app: Express, deps: RegisterPrivateDeps) => Promise<void>
}

async function syncModRegistryJob() {
	try {
		await syncModRegistry()
	} catch (err) {
		console.error('[cleanup] Failed to sync mod registry:', err)
	}
}

async function start() {
	try {
		await loadConfigFromDb()

		// Load private features if available (not present in public builds).
		// The real ChallengeStrategy (launcher-integrity.service.ts) lives here
		// too -- see that module's doc comment for why running without it is
		// expected and simply disables the feature, not an error.
		const setChallengeStrategy = (strategy: ChallengeStrategy) => {
			nakamaIntegrityService.setChallengeStrategy(strategy)
		}
		const privatePath: string = '@v-rtualized/bmp-internal'
		try {
			const { registerPrivate } = (await import(privatePath)) as PrivateModule
			await registerPrivate(app, { setChallengeStrategy })
		} catch {
			// running without private features
		}
		if (!nakamaIntegrityService.isEnabled() && env.DEV_FAKE_LAUNCHER_STRATEGY) {
			console.warn(
				'[launcher-integrity] Using the dev challenge strategy (DEV_FAKE_LAUNCHER_STRATEGY)',
			)
			setChallengeStrategy(createDevChallengeStrategy())
		}
		// Nakama gates ranked on integrity only when there is a strategy to
		// check it with.
		setIntegrityEnforced(nakamaIntegrityService.isEnabled())
		void pushConfigToNakama(getConfig())

		app.use(errorHandler)

		startSessionCleanup()

		void purgeReportedLobbyMessagesJob()
		setInterval(() => void purgeReportedLobbyMessagesJob(), 60 * 60 * 1000)

		// Chat, evidence and ban records past their retention limit.
		startRetentionSweepJob()

		// Games reach the website and webadmin through the mirror...
		startMirrorJob()
		// ...and Nakama drops what they no longer keep.
		startRetentionJob()
		startSeasonJob()
		// Players hear when a ban ends.
		startBanEndJob()


		server = app.listen(env.PORT, () => {
			console.log(`[server] API server listening on port ${env.PORT}`)
		})

		process.on('SIGTERM', shutdown)
		process.on('SIGINT', shutdown)

		// Fire-and-forget, run after the server is already accepting
		// connections: mod_registry is a persisted table, not rebuilt from
		// scratch, so a request that lands before this boot's own sync
		// finishes just sees the previous sync's data (at most one hourly
		// cycle stale), not an empty catalog. That's a better trade than
		// blocking app.listen() on it -- a slow/rate-limited BETModIndex or
		// GitHub hash fetch used to hold the deploy's health check (and thus
		// the whole port) closed for minutes, which a blue-green swap's own
		// health-check timeout has no way to distinguish from an actually
		// broken boot. syncModRegistryJob() already swallows its own errors,
		// so this can't crash startup either way.
		// Same reasoning: pins with no SMODS ids get them read from their
		// downloads, so the allowed-mod set can never be empty unnoticed. It
		// never throws and pushes the config to Nakama itself.
		void fillMissingSmodsIds()
		// Achievement progress from the games Nakama already holds. Nakama
		// fills each player once, so a later boot changes nothing.
		void fillAchievementsAtBoot()
		void syncModRegistryJob()
		setInterval(() => void syncModRegistryJob(), 60 * 60 * 1000).unref()
	} catch (err) {
		console.error('[server] Failed to start:', err)
		process.exit(1)
	}
}

start()
