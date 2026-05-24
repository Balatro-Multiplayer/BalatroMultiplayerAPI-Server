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
