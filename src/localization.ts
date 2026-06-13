/**
 * Centralized user-facing strings.
 *
 * These are the messages the server sends to clients (e.g. error/warning
 * popups). Keeping them in one place makes them easy to review, reword, and
 * localize without hunting through the action handlers.
 */
export const messages = {
	lobbyDoesNotExist: 'Lobby does not exist.',
	lobbyNoLongerExists: 'Lobby no longer exists.',
	rejoinFailed: 'Could not rejoin lobby. Token invalid or slot expired.',
	lobbyFullOrMissing: 'Lobby is full or does not exist.',
	clientNotInLobby: 'Client not in Lobby',
	failedToParseMessage: 'Failed to parse message',
	/** Shown when a client's mod version is older than the server expects. */
	versionMismatch: (serverVersion: string): string =>
		`[WARN] Server expecting version ${serverVersion}`,
} as const
