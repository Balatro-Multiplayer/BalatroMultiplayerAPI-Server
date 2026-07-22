// Pure HTTP-input parsing for the draft feature: no req/res, no I/O -- takes
// plain values, returns typed data or throws ValidationError. Messages are
// technical (matchmaking.route.ts convention): these guards are unreachable by
// a normal client, defense-in-depth against a buggy/malicious one. Pure parsing
// keeps every rule unit-testable; the route handler stays parse -> service -> respond.

import { ValidationError } from '../../shared/utils/errors.js'

// matchId is an opaque route param, not user-composed text -- the bound
// rejects garbage input, not a real length limit.
const MAX_MATCH_ID_LENGTH = 128

export function parseMatchIdParam(params: { matchId?: unknown }): string {
	const { matchId } = params
	if (typeof matchId !== 'string' || matchId.trim().length === 0)
		throw new ValidationError('matchId is required')
	if (matchId.length > MAX_MATCH_ID_LENGTH)
		throw new ValidationError('matchId is invalid')
	return matchId
}
