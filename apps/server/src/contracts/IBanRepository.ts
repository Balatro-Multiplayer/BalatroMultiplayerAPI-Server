import type { BanType } from '../shared/types/index.js'

export interface IBanRepository {
	hasActiveBan(playerId: string, banType: BanType): Promise<boolean>
}
