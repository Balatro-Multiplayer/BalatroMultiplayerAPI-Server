// Players in one PvP game must run the same PvP version (X.Y.Z), because the
// versions read scores differently. The version comes from the mod report the
// server stores for the session (mod_report.ts), never from the client's join
// metadata. Pure.
import { parseReportedMod } from './mod_report'

export const PVP_MOD_ID = 'MultiplayerPvP'

export const VERSION_MISMATCH = 'version_mismatch'
export const VERSION_MISMATCH_MESSAGE = 'Everyone in a PvP game needs the same MultiplayerPvP version. Update the mod and try again.'

// The oldest PvP version the server referees: a PvP lobby refuses older ones.
export const MIN_PVP_VERSION = '1.1.0'
export const PVP_UPDATE_REQUIRED = 'PVP_UPDATE_REQUIRED'
export const PVP_UPDATE_REQUIRED_MESSAGE = `PvP needs MultiplayerPvP ${MIN_PVP_VERSION} or newer. Update the mod and try again.`

const X_Y_Z = /^v?(\d+\.\d+\.\d+)/

// The X.Y.Z of the reported PvP entry; '' when PvP is not reported. A version
// that has no X.Y.Z (MPAPI's 'UNK') stays as reported.
export function pvpVersionOf(reported: string[]): string {
	for (const entry of reported) {
		const mod = parseReportedMod(entry)
		if (mod.key !== PVP_MOD_ID) continue
		const match = X_Y_Z.exec(mod.version)
		return match ? match[1] : mod.version
	}
	return ''
}

// -1, 0 or 1 by numeric X.Y.Z parts; text that is not X.Y.Z sorts lowest.
function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		const x = pa[i] > 0 ? pa[i] : 0
		const y = pb[i] > 0 ? pb[i] : 0
		if (x !== y) return x < y ? -1 : 1
	}
	return 0
}

// True when a join to a lobby of `modId` is refused for the joiner's PvP
// version: only a PvP lobby asks, and a missing, unreadable or older version
// fails it. `pvpVersion` is what pvpVersionOf gives ('' when not reported).
export function pvpJoinRefused(
	modId: string,
	pvpVersion: string | undefined,
): boolean {
	if (modId !== PVP_MOD_ID) return false
	const match = X_Y_Z.exec(pvpVersion ?? '')
	if (!match) return true
	return compareVersions(match[1], MIN_PVP_VERSION) < 0
}

// Who is off the version most players run (the newer version wins a tie), in
// the order given. Empty when all agree.
export function versionOutliers(versionByPlayer: { [userId: string]: string }): string[] {
	const ids = Object.keys(versionByPlayer)
	const counts: { [version: string]: number } = {}
	for (const id of ids) counts[versionByPlayer[id]] = (counts[versionByPlayer[id]] || 0) + 1
	let kept = ''
	let keptCount = 0
	for (const version of Object.keys(counts)) {
		const better =
			counts[version] > keptCount || (counts[version] === keptCount && compareVersions(version, kept) > 0)
		if (better) {
			kept = version
			keptCount = counts[version]
		}
	}
	return ids.filter((id) => versionByPlayer[id] !== kept)
}
