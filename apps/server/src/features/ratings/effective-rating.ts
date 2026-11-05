import { sql } from 'drizzle-orm'
import {
	DECAY_FLOOR,
	DECAY_INACTIVE_THRESHOLD_DAYS,
	DECAY_RATE_PER_DAY,
	PLACEMENT_GAMES,
} from './elo.js'

// Nakama decays an inactive rating when it next reads it and only stores the
// result after the player's next game, so the mirrored rating is the
// undecayed one. Apply the same decay here (rating/season.ts decayedRating).
// Every query that uses it reads matchmaking_ratings as `r`.
export const effectiveRating = sql.raw(`CASE
	WHEN r.games_played >= ${PLACEMENT_GAMES}
	 AND r.rating > ${DECAY_FLOOR}
	 AND r.last_match_at < now() - interval '${DECAY_INACTIVE_THRESHOLD_DAYS} days'
	THEN GREATEST(${DECAY_FLOOR}, r.rating - floor(extract(epoch FROM now() - r.last_match_at) / 86400 - ${DECAY_INACTIVE_THRESHOLD_DAYS})::int * ${DECAY_RATE_PER_DAY})
	ELSE r.rating END`)
