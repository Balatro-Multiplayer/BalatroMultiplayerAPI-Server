import type { IGracePeriodService } from '../../contracts/IGracePeriodService.js'
import type { IMatchmakingCoordinator } from '../../contracts/IMatchmakingCoordinator.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import type { JwtPayload } from '../../shared/types/index.js'
import { AppError } from '../../shared/utils/errors.js'
import { generateLobbyCode } from '../../shared/utils/lobby-code.js'
import { Lobby, getLobby, getSession, lobbies } from '../../state/index.js'
import type { PlayerSession } from '../../state/player.js'
import { signJwt } from '../auth/jwt.js'
import { replayLogService } from '../replay-log/replay-log.service.js'

interface LobbyServiceDeps {
	messageBus: IMessageBus
	gracePeriodService: IGracePeriodService
	matchmakingCoordinator: IMatchmakingCoordinator
}

// A session's lobbyCode can go stale if the lobby it referenced was ever torn
// down through a path that didn't clear it -- e.g. a race between a grace-
// period expiry deleting an abandoned lobby and that same player's client
// reconnecting, observed live: the player's own still-valid JWT kept claiming
// lobby membership for a lobby a direct lookup already 404'd. Treating a
// dangling reference as "not in a lobby" (rather than trusting it blindly)
// keeps a stale reference from permanently locking the player out of
// creating or joining anything new.
function clearStaleLobbyReference(session: PlayerSession): void {
	if (session.lobbyCode && !getLobby(session.lobbyCode)) {
		session.lobbyCode = undefined
	}
}

export type LobbyService = ReturnType<typeof createLobbyService>

export function createLobbyService(deps: LobbyServiceDeps) {
	const { messageBus, gracePeriodService, matchmakingCoordinator } = deps

	async function createLobby(
		player: JwtPayload,
		modId: string,
		maxPlayers?: number,
	) {
		const session = getSession(player.playerId)
		if (!session) throw new AppError('Player session not found', 401)

		clearStaleLobbyReference(session)
		if (session.lobbyCode) throw new AppError('Already in a lobby', 409)

		let code: string
		let attempts = 0
		do {
			code = generateLobbyCode()
			if (!lobbies.has(code)) break
			attempts++
		} while (attempts < 10)

		if (attempts >= 10)
			throw new AppError('Failed to generate unique lobby code', 500)

		const lobby = new Lobby(code, modId, player.playerId, maxPlayers, 'private')
		lobby.addPlayer(session)
		lobbies.set(code, lobby)

		await messageBus.publishPlayerInfo(lobby.code, player.playerId, {
			displayName: session.getDisplayName(),
			preferredJoker: session.preferredJoker,
			mods: session.installedMods,
		})

		const token = signJwt({
			playerId: player.playerId,
			steamName: player.steamName,
			lobbyCode: code,
		})

		return { lobby, token }
	}

	async function joinLobby(player: JwtPayload, code: string) {
		const session = getSession(player.playerId)
		if (!session) throw new AppError('Player session not found', 401)

		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		if (lobby.kickedPlayerIds.has(player.playerId)) {
			throw new AppError('You have been kicked from this lobby', 403)
		}

		if (lobby.type === 'public' && lobby.hasPlayer(player.playerId)) {
			const token = signJwt({
				playerId: player.playerId,
				steamName: player.steamName,
				lobbyCode: lobby.code,
			})
			return { lobby, token }
		}

		clearStaleLobbyReference(session)
		if (session.lobbyCode) throw new AppError('Already in a lobby', 409)
		if (lobby.hasPlayer(player.playerId))
			throw new AppError('Already in this lobby', 409)
		if (lobby.isFull) throw new AppError('Lobby is full', 409)

		lobby.addPlayer(session)

		await messageBus.publishPlayerInfo(lobby.code, player.playerId, {
			displayName: session.getDisplayName(),
			preferredJoker: session.preferredJoker,
			mods: session.installedMods,
		})

		if (lobby.type === 'private') {
			await matchmakingCoordinator.updateGroupQueueOnLobbyJoin(
				lobby.code,
				player.playerId,
			)
		}

		if (lobby.type === 'public') {
			await matchmakingCoordinator.syncMatchLobbyState(lobby.code)
		}

		const token = signJwt({
			playerId: player.playerId,
			steamName: player.steamName,
			lobbyCode: lobby.code,
		})

		await messageBus.publishEvent(lobby.code, {
			type: 'player_joined',
			lobbyCode: lobby.code,
			playerId: player.playerId,
			displayName: session.getDisplayName(),
			timestamp: new Date().toISOString(),
		})

		return { lobby, token }
	}

	async function leaveLobby(player: JwtPayload, code: string) {
		gracePeriodService.cancelGracePeriodSilently(player.playerId)

		const session = getSession(player.playerId)
		if (!session) throw new AppError('Player session not found', 401)

		const lobby = getLobby(code)
		if (!lobby) {
			// The lobby this session still points at is already gone (see
			// clearStaleLobbyReference above) -- there's nothing left to leave,
			// so clear the dangling reference and succeed rather than 404ing a
			// client that's just trying to get back to a clean state.
			if (session.lobbyCode === code) session.lobbyCode = undefined
			throw new AppError('Lobby not found', 404)
		}
		if (!lobby.hasPlayer(player.playerId))
			throw new AppError('Not in this lobby', 400)

		lobby.removePlayer(player.playerId)

		// An explicit leave mid-match is an immediate forfeit, not a disconnect
		// -- no 2-minute grace period. No-op if this lobby has no active
		// matchmaking match (private/practice lobbies, or an already-resolved
		// match). "Remaining connected" excludes anyone currently mid-grace-
		// period themselves, same as grace-period.service.ts's own expiry path,
		// so a player who's merely disconnected (not actually present) never
		// gets credited as the winner.
		const remainingConnected = [...lobby.players.keys()].filter(
			(id) => !gracePeriodService.isInGracePeriod(id),
		)
		await matchmakingCoordinator.forfeitMatchForLeave(
			lobby.code,
			player.playerId,
			remainingConnected,
		)

		if (lobby.type === 'private') {
			matchmakingCoordinator.removeGroupQueueForLobby(lobby.code)
		}

		await messageBus.clearPlayerInfo(lobby.code, player.playerId)
		await messageBus.cleanupPlayerState(lobby.code, player.playerId)

		await messageBus.publishEvent(lobby.code, {
			type: 'player_left',
			lobbyCode: lobby.code,
			playerId: player.playerId,
			displayName: session.getDisplayName(),
			timestamp: new Date().toISOString(),
		})

		if (lobby.hostId === player.playerId) {
			if (lobby.isEmpty) {
				await messageBus.publishEvent(lobby.code, {
					type: 'lobby_closed',
					lobbyCode: lobby.code,
					timestamp: new Date().toISOString(),
				})
				await messageBus.cleanupLobbyTopics(lobby.code, [player.playerId])
				lobbies.delete(lobby.code)
				await replayLogService.finalizeRun(lobby.code, 'terminated')
			} else {
				const newHostId = lobby.players.keys().next().value!
				lobby.hostId = newHostId

				await messageBus.publishEvent(lobby.code, {
					type: 'host_changed',
					lobbyCode: lobby.code,
					playerId: newHostId,
					timestamp: new Date().toISOString(),
				})
			}
		}

		if (lobby.isEmpty) {
			await messageBus.cleanupLobbyTopics(lobby.code, [player.playerId])
			lobbies.delete(lobby.code)
			await replayLogService.finalizeRun(lobby.code, 'terminated')
		}

		const token = signJwt({
			playerId: player.playerId,
			steamName: player.steamName,
		})

		return { token }
	}

	// Shared by the host-initiated kick and the admin-initiated kick/close
	// actions below. Removes targetPlayerId from lobby and does all the
	// bookkeeping a removal needs regardless of who initiated it or why:
	// grace-period cancel, kickedPlayerIds tracking (so a fast rejoin can't
	// race past joinLobby's guard), match forfeiture, and the player_kicked
	// broadcast. Does NOT handle host reassignment or lobby teardown -- kickPlayer
	// never needs to (the host can't kick themselves, so the lobby can't end up
	// empty or host-less through that path), but the admin paths can target
	// anyone including the host, so they handle those cases themselves.
	async function removePlayerFromLobby(
		lobby: Lobby,
		targetPlayerId: string,
		kickedBy: string,
	): Promise<void> {
		gracePeriodService.cancelGracePeriodSilently(targetPlayerId)

		const targetSession = getSession(targetPlayerId)

		lobby.kickedPlayerIds.add(targetPlayerId)
		lobby.removePlayer(targetPlayerId)

		const remainingConnected = [...lobby.players.keys()].filter(
			(id) => !gracePeriodService.isInGracePeriod(id),
		)
		await matchmakingCoordinator.forfeitMatchForLeave(
			lobby.code,
			targetPlayerId,
			remainingConnected,
		)

		// Published before the cleanup calls below so the kicked client still has
		// a live topic subscription when the event lands.
		await messageBus.publishEvent(lobby.code, {
			type: 'player_kicked',
			lobbyCode: lobby.code,
			playerId: targetPlayerId,
			displayName: targetSession?.getDisplayName(),
			data: { kickedBy },
			timestamp: new Date().toISOString(),
		})

		await messageBus.clearPlayerInfo(lobby.code, targetPlayerId)
		await messageBus.cleanupPlayerState(lobby.code, targetPlayerId)
	}

	// Mirrors leaveLobby's empty-lobby teardown (lobby_closed broadcast, topic
	// cleanup, map removal, run finalization) for the admin paths, which can
	// empty a lobby by kicking its last member or by closing it outright --
	// neither goes through leaveLobby itself. No player exclusion on
	// cleanupLobbyTopics (unlike leaveLobby's), since these removals aren't
	// initiated by the player themselves and their client hasn't already
	// unsubscribed on its own.
	async function closeEmptiedLobby(lobby: Lobby): Promise<void> {
		await messageBus.publishEvent(lobby.code, {
			type: 'lobby_closed',
			lobbyCode: lobby.code,
			timestamp: new Date().toISOString(),
		})
		await messageBus.cleanupLobbyTopics(lobby.code)
		lobbies.delete(lobby.code)
		await replayLogService.finalizeRun(lobby.code, 'terminated')
	}

	// Host-initiated removal of another player. Mirrors leaveLobby's cleanup for
	// the target, but the actor (host) is not leaving -- no host-transfer or
	// lobby-close branch applies here.
	async function kickPlayer(
		player: JwtPayload,
		code: string,
		targetPlayerId: string,
	) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		if (lobby.hostId !== player.playerId) {
			throw new AppError('Only the host can kick players', 403)
		}
		if (targetPlayerId === player.playerId) {
			throw new AppError('Cannot kick yourself', 400)
		}
		if (!lobby.hasPlayer(targetPlayerId)) {
			throw new AppError('Player not in this lobby', 400)
		}

		await removePlayerFromLobby(lobby, targetPlayerId, player.playerId)
	}

	// Admin/moderator-initiated removal from the webadmin lobby-management panel.
	// Unlike kickPlayer, the target can be the host -- the acting admin isn't a
	// lobby member, so there's no self-kick restriction, and no membership check
	// on who's allowed to act (the webadmin route already gates on privilege).
	async function adminKickPlayer(
		code: string,
		targetPlayerId: string,
		actingAdminId: string,
	) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		if (!lobby.hasPlayer(targetPlayerId)) {
			throw new AppError('Player not in this lobby', 400)
		}

		const wasHost = lobby.hostId === targetPlayerId
		await removePlayerFromLobby(lobby, targetPlayerId, `admin:${actingAdminId}`)

		if (lobby.isEmpty) {
			await closeEmptiedLobby(lobby)
			return
		}

		if (wasHost) {
			const newHostId = lobby.players.keys().next().value!
			lobby.hostId = newHostId
			await messageBus.publishEvent(lobby.code, {
				type: 'host_changed',
				lobbyCode: lobby.code,
				playerId: newHostId,
				timestamp: new Date().toISOString(),
			})
		}
	}

	// Force-closes a lobby regardless of membership -- e.g. an abandoned lobby
	// whose owner's session went stale (see clearStaleLobbyReference above) with
	// no way to self-resolve. Removes every current member (forfeiting any
	// active match, same as each of them leaving individually would) and then
	// tears the lobby down.
	async function adminCloseLobby(code: string, actingAdminId: string) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)

		for (const targetPlayerId of [...lobby.players.keys()]) {
			await removePlayerFromLobby(
				lobby,
				targetPlayerId,
				`admin:${actingAdminId}`,
			)
		}

		if (lobby.isEmpty) {
			await closeEmptiedLobby(lobby)
		}
	}

	function getLobbyInfo(code: string) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		return lobby
	}

	function getLobbyPlayers(code: string) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)

		return Array.from(lobby.players.values()).map((p) => ({
			id: p.playerId,
			displayName: p.getDisplayName(),
			preferredJoker: p.preferredJoker,
			isAway: gracePeriodService.isInGracePeriod(p.playerId),
		}))
	}

	async function setMetadata(
		player: JwtPayload,
		code: string,
		metadata: Record<string, unknown>,
	) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		if (lobby.hostId !== player.playerId)
			throw new AppError('Only the host can set metadata', 403)

		lobby.metadata = { ...lobby.metadata, ...metadata }

		await messageBus.publishMetadata(lobby.code, lobby.metadata)

		if (lobby.type === 'public') {
			await matchmakingCoordinator.syncMatchLobbyState(lobby.code)
		}

		await messageBus.publishEvent(lobby.code, {
			type: 'metadata_changed',
			lobbyCode: lobby.code,
			data: lobby.metadata,
			timestamp: new Date().toISOString(),
		})

		return lobby.metadata
	}

	return {
		createLobby,
		joinLobby,
		leaveLobby,
		kickPlayer,
		adminKickPlayer,
		adminCloseLobby,
		getLobbyInfo,
		getLobbyPlayers,
		setMetadata,
	}
}
