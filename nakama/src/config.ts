// Server-wide switches. The BMP API (Express) owns them -- webadmin edits
// them in Postgres -- and pushes every change here through admin_config_set,
// so they live in one system-owned storage object. Read it on each use:
// every Nakama JavaScript VM has its own globals, so a cached copy would go
// stale on the others.
import { SYSTEM_USER_ID } from './lobby/protocol'
import { PVP_MODES, type PvpMode } from './lobby/pvp/state'

export const CONFIG_COLLECTION = 'server_config'
export const CONFIG_KEY = 'global'

export interface ServerConfig {
	chatEnabled: boolean
	rankedEnabled: boolean
	casualQueueEnabled: boolean
	// A private lobby may queue casual matchmaking as one group
	// (matchmaking/group); its members still need casualQueueEnabled.
	groupQueueEnabled: boolean
	lobbyCreationEnabled: boolean
	// Only 'tester'-privileged players may create lobbies or queue.
	testingMode: boolean
	// Ranked needs a launcher-integrity verdict from the API.
	integrityEnforced: boolean
	// Finished games count toward avatar achievements (achievements/record.ts).
	// Locked avatars stay locked either way.
	achievementsEnabled: boolean
	// Chat messages that skip moderation, as webadmin lists them (looked up by
	// chat/filter.ts normalizeForAllowlist).
	chatAllowlist: string[]
	// The API's active rating season (rating/season.ts); 0 until pushed.
	season: number
	// The SMODS ids of the ranked-pinned mods, as the API pushes them.
	queueAllowedModIds: string[]
	// More allowed ids, set here only (test harnesses' dev mods, seeded at
	// boot from QUEUE_ALLOWED_MOD_IDS_EXTRA -- standing/seed.ts); the API
	// never sends it, so its pushes leave it be.
	queueAllowedModIdsExtra: string[]
	// The PvP game modes switched off (the kill switch): a disabled mode is
	// refused at the queue, at lobby create and at game start (mode_disabled).
	// Disabling nemesis also disables ranked, which is always Nemesis.
	disabledPvpModes: PvpMode[]
}

// Until the API's first push: everything Nakama already did stays allowed.
export const DEFAULT_CONFIG: ServerConfig = {
	chatEnabled: true,
	rankedEnabled: true,
	casualQueueEnabled: true,
	groupQueueEnabled: true,
	lobbyCreationEnabled: true,
	testingMode: false,
	integrityEnforced: false,
	achievementsEnabled: true,
	chatAllowlist: [],
	season: 0,
	queueAllowedModIds: [],
	queueAllowedModIdsExtra: [],
	disabledPvpModes: [],
}

// The list as pushed: only whole lists of known modes (each at most once) are
// taken; anything else is null, and mergeConfig keeps the current list.
export function pvpModesOf(value: unknown): PvpMode[] | null {
	if (!Array.isArray(value)) return null
	const modes: PvpMode[] = []
	for (const entry of value) {
		const known = PVP_MODES.find((mode) => mode === entry)
		if (known === undefined || modes.indexOf(known) !== -1) return null
		modes.push(known)
	}
	return modes
}

const MAX_MOD_IDS = 500
const MOD_ID_PATTERN = /^[^\s]{1,128}$/

export function modIdsOf(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_MOD_IDS) return null
	if (!value.every((id) => typeof id === 'string' && MOD_ID_PATTERN.test(id))) return null
	return value as string[]
}

// current with every valid field of update applied; unknown keys and wrongly
// typed values are ignored.
export function mergeConfig(current: ServerConfig, update: { [key: string]: unknown }): ServerConfig {
	const next: ServerConfig = { ...current }
	const season = update.season
	if (typeof season === 'number' && Number.isInteger(season) && season > 0) next.season = season
	const flags: (keyof ServerConfig)[] = [
		'chatEnabled',
		'rankedEnabled',
		'casualQueueEnabled',
		'groupQueueEnabled',
		'lobbyCreationEnabled',
		'testingMode',
		'integrityEnforced',
		'achievementsEnabled',
	]
	for (const flag of flags) {
		const value = update[flag]
		if (typeof value === 'boolean') (next as unknown as { [k: string]: unknown })[flag] = value
	}
	const allowlist = update.chatAllowlist
	if (Array.isArray(allowlist) && allowlist.every((m) => typeof m === 'string'))
		next.chatAllowlist = allowlist as string[]
	const allowedIds = modIdsOf(update.queueAllowedModIds)
	if (allowedIds) next.queueAllowedModIds = allowedIds
	const extraIds = modIdsOf(update.queueAllowedModIdsExtra)
	if (extraIds) next.queueAllowedModIdsExtra = extraIds
	const disabledModes = pvpModesOf(update.disabledPvpModes)
	if (disabledModes) next.disabledPvpModes = disabledModes
	return next
}

export type ClientConfig = Omit<ServerConfig, 'chatAllowlist' | 'queueAllowedModIds' | 'queueAllowedModIdsExtra'>

// What a client is shown (the login response): the switches, not the
// moderators' allowlist nor the mod allowlists (account_standing answers
// for those).
export function clientConfig(config: ServerConfig): ClientConfig {
	const { chatAllowlist, queueAllowedModIds, queueAllowedModIdsExtra, ...shown } = config
	return shown
}

// A stored `disabledPvpModes` that is not a whole list of known modes is dropped
// and reads as none disabled (the default), so the kill switch would be off with
// no sign of it: pass the logger where a decision hangs on the list, and it warns.
export function readConfig(nk: nkruntime.Nakama, logger?: nkruntime.Logger): ServerConfig {
	const objects = nk.storageRead([{ collection: CONFIG_COLLECTION, key: CONFIG_KEY, userId: SYSTEM_USER_ID }])
	const stored = objects.length > 0 ? objects[0].value : {}
	if (logger && stored.disabledPvpModes !== undefined && pvpModesOf(stored.disabledPvpModes) === null)
		logger.warn('Stored config field disabledPvpModes is malformed and is ignored: no PvP mode is switched off')
	return mergeConfig(DEFAULT_CONFIG, stored)
}

export function writeConfig(nk: nkruntime.Nakama, config: ServerConfig) {
	nk.storageWrite([
		{
			collection: CONFIG_COLLECTION,
			key: CONFIG_KEY,
			userId: SYSTEM_USER_ID,
			value: config as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
}
