// When a failed (or refused) launcher challenge becomes a service-queue item:
// only while the player is ranked-queued or in a ranked game. A failure at any
// other time is kept as an event and shown on the player page, but makes no
// item. One item per player per day.
import { utcDayOf } from '../../shared/service-queue/source-ids.js'
import type { IntegrityTrigger } from './types.js'

export interface IntegrityFailureContext {
	ranked: { queued: boolean; inGame: boolean } | null
}

export type IntegrityFlagDecision = { kind: 'raise'; trigger: IntegrityTrigger } | { kind: 'none' }

export function decideIntegrityFlag(context: IntegrityFailureContext): IntegrityFlagDecision {
	if (context.ranked && (context.ranked.queued || context.ranked.inGame)) return { kind: 'raise', trigger: 'ranked' }
	return { kind: 'none' }
}

export function utcDayStart(at: Date): Date {
	return new Date(`${utcDayOf(at)}T00:00:00.000Z`)
}
