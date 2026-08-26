import type { Server } from 'node:http'
import { lt } from 'drizzle-orm'
import express from 'express'
import type { Express, Request, Response } from 'express'
import { env } from './env.js'
import { launcherIntegrityService } from './features/launcher-integrity/launcher-integrity.service.js'
import {
	startDailyJob,
	stopDailyJob,
} from './features/matchmaking/matchmaking.service.js'
import { syncModRegistry } from './features/mods/mods-sync.service.js'
import { replayLogService } from './features/replay-log/replay-log.service.js'
import { db, pool } from './infrastructure/db/index.js'
import { chatLogs, flaggedMessages } from './infrastructure/db/schema.js'
import { provisionEmqxWebhook } from './infrastructure/emqx/emqx-provision.service.js'
import { forceReconnectStalePlayers } from './infrastructure/emqx/reconnect-recovery.service.js'
import { loadConfigFromDb } from './infrastructure/gateways/config.gateway.js'
import { purgeExpiredDeletedPlayerHashes } from './infrastructure/gateways/player.gateway.js'
import { purgeExpiredRunLogs } from './infrastructure/gateways/replay-log.gateway.js'
import {
	clearAllGracePeriods,
	restoreGracePeriodsFromDb,
} from './infrastructure/mqtt/grace-period.service.js'
import { mqttService } from './infrastructure/mqtt/mqtt.service.js'
import { clearAllSpectatorGrants } from './infrastructure/mqtt/spectator-registry.js'
import { errorHandler } from './middleware/errorHandler.js'
import router, { matchmakingService } from './routes/index.js'
import type { RegisterPrivateDeps } from './shared/types/index.js'
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
	matchmakingService.stopMatchmaking()
	stopDailyJob()
	stopSessionCleanup()
	// Grace-period timers are cleared here, not resolved -- that's fine now
	// that they're also persisted (grace-period.gateway.ts): the next boot's
	// restoreGracePeriodsFromDb() picks up wherever this left off, instead of
	// the countdown silently vanishing the way it used to.
	clearAllGracePeriods()
	clearAllSpectatorGrants()
	launcherIntegrityService.clearAll()

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

	const result = await Promise.race([shutdownSteps().then(() => 'done' as const), timeout])
	if (result === 'timeout') {
		console.error(
			`[server] Shutdown did not complete within ${SHUTDOWN_DEADLINE_MS}ms, exiting anyway`,
		)
	}

	process.exit(0)
}

async function purgeExpiredFlaggedMessages() {
	try {
		await db
			.delete(flaggedMessages)
			.where(lt(flaggedMessages.expiresAt, new Date()))
	} catch (err) {
		console.error('[cleanup] Failed to purge expired flagged messages:', err)
	}
}

async function purgeExpiredRunLogsJob() {
	try {
		await purgeExpiredRunLogs()
	} catch (err) {
		console.error('[cleanup] Failed to purge expired run logs:', err)
	}
}

async function purgeExpiredChatLogsJob() {
	try {
		await db.delete(chatLogs).where(lt(chatLogs.expiresAt, new Date()))
	} catch (err) {
		console.error('[cleanup] Failed to purge expired chat logs:', err)
	}
}

async function purgeExpiredDeletedPlayerHashesJob() {
	try {
		await purgeExpiredDeletedPlayerHashes()
	} catch (err) {
		console.error(
			'[cleanup] Failed to purge expired deleted-player hashes:',
			err,
		)
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
		const privatePath: string = '@v-rtualized/bmp-internal'
		try {
			const { registerPrivate } = (await import(privatePath)) as PrivateModule
			await registerPrivate(app, {
				setChallengeStrategy: launcherIntegrityService.setChallengeStrategy,
			})
		} catch {
			// running without private features
		}

		app.use(errorHandler)

		await mqttService.connect()
		await provisionEmqxWebhook()
		// One subscription per consuming mod's own RLOG action key -- each mod
		// (BalatroMultiplayerPvP, BalatroMultiplayerSpeed) wires its own
		// ActionType to MPAPI.replay's live transport client-side (see
		// MPAPI.replay.register_broadcaster in BalatroMultiplayerAPI's
		// recorder.lua), but they all feed the same replayLogService buffer
		// server-side -- handleActionLogEvent itself is mod-agnostic.
		for (const actionKey of ['pvp_log_event', 'spdrn_log_event']) {
			await mqttService.subscribeToLobbyActions(
				actionKey,
				(lobbyCode, playerId, params) => {
					void replayLogService
						.handleActionLogEvent(lobbyCode, playerId, params)
						.catch((err) =>
							console.error('[replay-log] Failed to buffer event:', err),
						)
				},
			)
		}
		await mqttService.subscribeToPlayerChallengeResponses(
			(playerId, payload) => {
				void launcherIntegrityService
					.handleChallengeResponse(playerId, payload)
					.catch((err) =>
						console.error(
							'[launcher-integrity] Failed to handle challenge response:',
							err,
						),
					)
			},
		)

		await matchmakingService.restoreMatchesFromDb()
		await restoreGracePeriodsFromDb()
		// Unconditional on every boot (planned deploy or a bare crash-restart
		// alike) -- see reconnect-recovery.service.ts's doc comment for why the
		// client can't detect an app-only restart on its own, and
		// auth.service.ts's reattachRestoredSession for what actually restores
		// state once the forced reconnect lands.
		void forceReconnectStalePlayers(matchmakingService.getActiveMatchPlayerIds()).catch(
			(err) => console.error('[reconnect-recovery] Failed to force stale reconnects:', err),
		)
		matchmakingService.startMatchmaking()
		startDailyJob()

		startSessionCleanup()

		void purgeExpiredFlaggedMessages()
		setInterval(() => void purgeExpiredFlaggedMessages(), 60 * 60 * 1000)

		void purgeExpiredRunLogsJob()
		setInterval(() => void purgeExpiredRunLogsJob(), 60 * 60 * 1000).unref()

		void purgeExpiredChatLogsJob()
		setInterval(() => void purgeExpiredChatLogsJob(), 60 * 60 * 1000).unref()

		void purgeExpiredDeletedPlayerHashesJob()
		setInterval(
			() => void purgeExpiredDeletedPlayerHashesJob(),
			60 * 60 * 1000,
		).unref()

		// Blocking, not fire-and-forget: the mod catalog (and every mod's
		// server-computed hash) must be correct before the very first request
		// is served, not eventually-consistent a few seconds after boot.
		// syncModRegistryJob() already swallows its own errors (logs and
		// returns), so a slow/broken BETModIndex fetch delays startup but never
		// crashes it. Subsequent runs stay on the hourly background interval.
		await syncModRegistryJob()
		setInterval(() => void syncModRegistryJob(), 60 * 60 * 1000).unref()

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
