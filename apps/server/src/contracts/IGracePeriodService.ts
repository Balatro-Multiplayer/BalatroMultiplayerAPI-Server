export interface IGracePeriodService {
	cancelGracePeriod(playerId: string): Promise<boolean>
	cancelGracePeriodSilently(playerId: string): void
	isInGracePeriod(playerId: string): boolean
	clearAllGracePeriods(): void
}
