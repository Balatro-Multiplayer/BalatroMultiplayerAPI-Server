// Names the stored match log shares between the server and the website.
//
// PVP_BLIND_KEY is the blind key PvP records in select_blind for the PvP
// round. RESULT_OPCODE lists the replay log events that give a match's result,
// lives lost and PvP blind scores: the server keeps only these for a side its
// player has not shared (apps/server/src/features/replay-log/hidden-side.ts).
//
// Plain ES2015 with no imports: the Nakama bundle includes this package too.

export const PVP_BLIND_KEY = 'bl_mp_nemesis'

export const RESULT_OPCODE = {
	SELECT_BLIND: 'select_blind',
	SKIP_BLIND: 'skip_blind',
	HAND_RESULT: 'hand_result',
	LIFE_LOST: 'life_lost',
	END: 'end',
} as const

export type ResultOpcode = (typeof RESULT_OPCODE)[keyof typeof RESULT_OPCODE]
