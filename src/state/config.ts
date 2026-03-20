import { db } from '../db/index.js'
import { serverConfig, modVersions } from '../db/schema.js'

export interface ModConfig {
	modId: string
	displayName: string
	version: string
	downloadUrl: string
}

export interface AppConfig {
	tosVersion: number
	mods: ModConfig[]
}

let _config: AppConfig = { tosVersion: 1, mods: [] }

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

	const config: AppConfig = { tosVersion, mods }
	setConfig(config)
	return config
}
