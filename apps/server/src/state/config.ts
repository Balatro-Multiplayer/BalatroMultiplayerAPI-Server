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
	// Global chat kill-switch. When falsy, the server rejects all chat sends.
	chatEnabled?: boolean
	// When truthy, only 'tester'-privileged players may create lobbies / queue.
	testingMode?: boolean
	// When falsy, ranked queue requests are rejected; casual is unaffected.
	rankedEnabled?: boolean
}

let _config: AppConfig = {
	tosVersion: 1,
	mods: [],
	chatAllowlist: new Set(),
	chatEnabled: false,
	testingMode: false,
	rankedEnabled: true,
}

export function getConfig(): AppConfig {
	return _config
}

export function setConfig(c: AppConfig): void {
	_config = c
}
