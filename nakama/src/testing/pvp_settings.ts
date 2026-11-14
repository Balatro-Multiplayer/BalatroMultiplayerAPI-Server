import { settingsFromMetadata } from '../lobby/pvp/settings'
import type { PvpSettings } from '../lobby/pvp/state'

// The same settings as a plain value: for the tests and fixtures that build a
// referee state from metadata they know is valid. A bad key throws.
export function settingsAtStart(
	metadata: { [key: string]: unknown },
	startedIds: string[],
): PvpSettings {
	const result = settingsFromMetadata(metadata, startedIds)
	if (!result.ok) throw new Error(`bad_rules: ${result.key}`)
	return result.settings
}
