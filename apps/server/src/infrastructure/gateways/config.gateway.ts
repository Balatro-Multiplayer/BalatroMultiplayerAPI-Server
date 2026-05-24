import { db } from '../db/index.js'
import { serverConfig, modVersions, chatAllowlist } from '../db/schema.js'
import type { AppConfig } from '../../state/config.js'
import { setConfig } from '../../state/config.js'

export async function loadConfigFromDb(): Promise<AppConfig> {
	await db
		.insert(serverConfig)
		.values({ id: 1, tosVersion: 1 })
		.onConflictDoNothing()

	const configRow = await db.query.serverConfig.findFirst()
	const tosVersion = configRow?.tosVersion ?? 1

	const modRows = await db.query.modVersions.findMany()
	const mods = modRows.map((row) => ({
		modId: row.modId,
		displayName: row.displayName,
		version: row.version,
		downloadUrl: row.downloadUrl,
	}))

	const allowlistRows = await db.select().from(chatAllowlist)
	const chatAllowlistSet = new Set(allowlistRows.map((r) => r.message))

	const config: AppConfig = { tosVersion, mods, chatAllowlist: chatAllowlistSet }
	setConfig(config)
	return config
}
