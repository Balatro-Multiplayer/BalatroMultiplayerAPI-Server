-- A player shares only their own side of a match. NULL means not shared.
ALTER TABLE "match_run_logs" ADD COLUMN IF NOT EXISTS "shared_at" timestamp with time zone;
