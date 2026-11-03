// Whether a player holds the admin or moderator privilege, read from the
// database (not the in-memory session) so a moderator browsing the website
// without a live game session still counts.
export interface IModeratorLookup {
	isModerator(playerId: string): Promise<boolean>
}
