// Why a player may not queue, as a closed set the client can tell apart, each
// with an English message built here as the fallback text. Pure.
import { INTEGRITY_REQUIRED } from '../integrity'
import {
	type PVP_UPDATE_REQUIRED,
	PVP_UPDATE_REQUIRED_MESSAGE,
	VERSION_MISMATCH,
	VERSION_MISMATCH_MESSAGE,
} from '../standing/pvp_version'
import type { StandingResult } from '../standing/standing'
import { type MODE_DISABLED, MODE_DISABLED_MESSAGE } from './mode_switch'

export type QueueRefusal =
	// A switch, a queue ban or testing mode (moderation/access.ts), as worded there.
	| { code: 'access_denied'; message: string }
	// Ranked while integrityEnforced, without a launcher verdict (integrity.ts).
	| { code: 'integrity_required' }
	// The session's mod report lists mods that aren't allowed.
	| { code: 'mods_not_allowed'; mods: string[] }
	// No mod report this session.
	| { code: 'mods_unreported' }
	// Matched with players on another PvP version (standing/pvp_version.ts).
	| { code: typeof VERSION_MISMATCH }
	// The PvP mode asked for is switched off (config.disabledPvpModes).
	| { code: typeof MODE_DISABLED }
	// A PvP ticket from a version older than the server referees (MIN_PVP_VERSION).
	| { code: typeof PVP_UPDATE_REQUIRED }

export type QueueRefusalCode = QueueRefusal['code']

// Matchmaking stays strict, but a private lobby takes any mods.
export const PRIVATE_LOBBIES_ALLOW_ANY_MODS = 'Private lobbies allow any mods.'

export function queueRefusalMessage(refusal: QueueRefusal): string {
	switch (refusal.code) {
		case 'access_denied':
			return refusal.message
		case 'integrity_required':
			return INTEGRITY_REQUIRED
		case 'mods_not_allowed':
			return "These mods aren't allowed in matchmaking: " + refusal.mods.join(', ') + '. ' + PRIVATE_LOBBIES_ALLOW_ANY_MODS
		case 'version_mismatch':
			return VERSION_MISMATCH_MESSAGE
		case 'mode_disabled':
			return MODE_DISABLED_MESSAGE
		case 'PVP_UPDATE_REQUIRED':
			return PVP_UPDATE_REQUIRED_MESSAGE
		case 'mods_unreported':
			return "Your game hasn't reported its mods yet. Reconnect and try again."
	}
}

// The refusal a standing of none answers with; null for valid or verified.
export function standingRefusal(result: StandingResult): QueueRefusal | null {
	if (result.standing !== 'none') return null
	return result.reason === 'mods_not_allowed'
		? { code: 'mods_not_allowed', mods: result.disallowed }
		: { code: 'mods_unreported' }
}

// The mods a refusal names; [] for the others.
export function refusedMods(refusal: QueueRefusal): string[] {
	return refusal.code === 'mods_not_allowed' ? refusal.mods : []
}

// A refusal over the account's standing, which a fresh report or an
// allowlist change can lift (the others are switches, bans and the launcher).
export function isStandingRefusal(refusal: QueueRefusal): boolean {
	return refusal.code === 'mods_not_allowed' || refusal.code === 'mods_unreported'
}
