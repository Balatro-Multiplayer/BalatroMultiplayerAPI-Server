// A ranked player who left (or forfeited) before the run began dodged the game
// (docs/pvp-match.md section 7). The game is stored 'dodged' and nobody is rated; this
// record is what the dodge penalty (queue timeout, MMR loss; a follow-up) reads, one
// per run and player.
export const DODGES_COLLECTION = 'dodges'

export interface Dodge {
	leaverId: string
	runId: string
	at: number
	rankedMode: string
}

export function recordDodge(nk: nkruntime.Nakama, dodge: Dodge) {
	nk.storageWrite([
		{
			collection: DODGES_COLLECTION,
			key: dodge.runId,
			userId: dodge.leaverId,
			value: dodge as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
}
