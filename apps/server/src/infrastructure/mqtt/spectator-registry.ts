// Tracks who currently holds a live spectator grant for which lobby. A grant is
// issued by GET /api/lobbies/:code/spectate (a normal player JWT scoped with
// `lobbyCode`, per design doc §26.3) and consulted by the EMQX authz webhook to
// allow read-only subscribe on `lobby/{code}/+/+` without lobby membership.
// In-memory only -- spectating is not persisted, matching the design doc's
// "the server records the spectator in memory only (no DB row)".

const SPECTATOR_CAP_PER_LOBBY = 50
const SPECTATOR_GRANT_TTL_MS = 6 * 60 * 60 * 1000 // safety net; normal exit is MQTT disconnect

interface SpectatorGrant {
	lobbyCode: string
	timer: ReturnType<typeof setTimeout>
}

const grants = new Map<string, SpectatorGrant>() // playerId -> grant
const spectatorsByLobby = new Map<string, Set<string>>() // lobbyCode -> playerIds

export function countSpectators(lobbyCode: string): number {
	return spectatorsByLobby.get(lobbyCode)?.size ?? 0
}

// Returns false (grants nothing) once the lobby's spectator cap is reached.
export function grantSpectator(playerId: string, lobbyCode: string): boolean {
	const existing = grants.get(playerId)
	if (existing) {
		if (existing.lobbyCode === lobbyCode) return true
		revokeSpectator(playerId)
	}

	if (countSpectators(lobbyCode) >= SPECTATOR_CAP_PER_LOBBY) return false

	const timer = setTimeout(
		() => revokeSpectator(playerId),
		SPECTATOR_GRANT_TTL_MS,
	)
	timer.unref()
	grants.set(playerId, { lobbyCode, timer })

	let set = spectatorsByLobby.get(lobbyCode)
	if (!set) {
		set = new Set()
		spectatorsByLobby.set(lobbyCode, set)
	}
	set.add(playerId)

	return true
}

export function getSpectatorGrant(
	playerId: string,
): { lobbyCode: string } | undefined {
	const grant = grants.get(playerId)
	return grant ? { lobbyCode: grant.lobbyCode } : undefined
}

export function revokeSpectator(playerId: string): void {
	const grant = grants.get(playerId)
	if (!grant) return

	clearTimeout(grant.timer)
	grants.delete(playerId)

	const set = spectatorsByLobby.get(grant.lobbyCode)
	if (set) {
		set.delete(playerId)
		if (set.size === 0) spectatorsByLobby.delete(grant.lobbyCode)
	}
}

export function clearAllSpectatorGrants(): void {
	for (const grant of grants.values()) clearTimeout(grant.timer)
	grants.clear()
	spectatorsByLobby.clear()
}
