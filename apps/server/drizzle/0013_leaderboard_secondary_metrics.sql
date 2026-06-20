-- Secondary per-season personal-best metrics tracked alongside Elo rating.
-- Meaning is mod-defined (score for PvP, duration_ms for speedrun); see metrics.config.ts.
ALTER TABLE "matchmaking_ratings" ADD COLUMN IF NOT EXISTS "season_best" bigint;
ALTER TABLE "matchmaking_ratings" ADD COLUMN IF NOT EXISTS "best_match_id" varchar(36);
ALTER TABLE "matchmaking_ratings" ADD COLUMN IF NOT EXISTS "best_at" timestamp with time zone;

ALTER TABLE "leaderboard_cache" ADD COLUMN IF NOT EXISTS "season_best" bigint;

-- Server-stamped run start, basis for server-measured timing leaderboards.
ALTER TABLE "matchmaking_matches" ADD COLUMN IF NOT EXISTS "game_started_at" timestamp with time zone;
