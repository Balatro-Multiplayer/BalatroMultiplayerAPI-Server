-- Collapse the two "current season" concepts into one source of truth:
-- the seasons table (active = the row with ended_at IS NULL). The server_config
-- pointer is no longer used by any code path.
ALTER TABLE "server_config" DROP COLUMN IF EXISTS "current_season";
