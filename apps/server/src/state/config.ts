import { db } from '../db/index.js'
import { serverConfig, modVersions, chatAllowlist } from '../db/schema.js'

export interface ModConfig {
	modId: string
	displayName: string
	version: string
	downloadUrl: string
}

export interface AppConfig {
	tosVersion: number
	mods: ModConfig[]
	chatAllowlist: Set<string>
}

let _config: AppConfig = { tosVersion: 1, mods: [], chatAllowlist: new Set() }

export function getConfig(): AppConfig {
	return _config
}

export function setConfig(c: AppConfig): void {
	_config = c
}

export async function loadConfigFromDb(): Promise<AppConfig> {
	// Ensure singleton config row exists
	await db
		.insert(serverConfig)
		.values({ id: 1, tosVersion: 1 })
		.onConflictDoNothing()

	const configRow = await db.query.serverConfig.findFirst()
	const tosVersion = configRow?.tosVersion ?? 1

	const modRows = await db.query.modVersions.findMany()
	const mods: ModConfig[] = modRows.map((row) => ({
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
