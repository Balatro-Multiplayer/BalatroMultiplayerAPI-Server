-- First-report-wins result reporting (§11.6): persists the authoritative first
-- result on matchmaking_matches so a later report for the same match can be
-- compared instead of just 404ing once the in-memory match is torn down, and
-- a new table to flag conflicting second reports for manual moderator review
-- (§21.5) -- the first report's outcome always stands automatically.
ALTER TABLE "matchmaking_matches" ADD COLUMN IF NOT EXISTS "result_placements" jsonb;
ALTER TABLE "matchmaking_matches" ADD COLUMN IF NOT EXISTS "result_reported_by" text;
ALTER TABLE "matchmaking_matches" ADD COLUMN IF NOT EXISTS "result_reported_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "match_result_conflicts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"match_id" varchar(36) NOT NULL,
	"lobby_code" varchar(6) NOT NULL,
	"first_reporter_id" text NOT NULL,
	"first_placements" jsonb NOT NULL,
	"conflicting_reporter_id" text NOT NULL,
	"conflicting_placements" jsonb NOT NULL,
	"status" varchar(16) NOT NULL DEFAULT 'open',
	"resolution_notes" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
