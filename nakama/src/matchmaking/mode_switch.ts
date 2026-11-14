// The PvP mode kill switch (config.disabledPvpModes) as pure checks: which
// mode a ticket asks for, and whether the switch has that mode off. Ranked is
// always Nemesis (lobby/pvp/ranked_pin.ts), so switching nemesis off switches
// ranked off with it.
import { modeOfQueue } from '../lobby/pvp/settings'
import type { PvpMode } from '../lobby/pvp/state'
import { PVP_MOD_ID } from '../standing/pvp_version'

export const MODE_DISABLED = 'mode_disabled'
export const MODE_DISABLED_MESSAGE = 'This game mode is currently disabled.'

// Whether the switch has `mode` off; a null mode (none known yet) is never
// refused here. A `ranked` game counts as nemesis.
export function modeDisabled(
	disabled: readonly PvpMode[],
	mode: PvpMode | null,
	ranked: boolean,
): boolean {
	if (ranked && disabled.indexOf('nemesis') !== -1) return true
	return mode !== null && disabled.indexOf(mode) !== -1
}

// Whether a ticket (or a matched queue) of `modId` asking for `mode` is
// switched off: only PvP has modes, and its casual queue names are the
// lobby's queue_mode values (pvp_royale, ...).
export function ticketModeDisabled(
	disabled: readonly PvpMode[],
	modId: unknown,
	mode: unknown,
	ranked: boolean,
): boolean {
	if (modId !== PVP_MOD_ID) return false
	return modeDisabled(disabled, ranked ? 'nemesis' : modeOfQueue(mode), ranked)
}
