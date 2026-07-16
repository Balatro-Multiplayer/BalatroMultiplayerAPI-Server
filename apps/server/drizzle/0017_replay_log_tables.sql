-- Compact action-log storage for replay/anti-cheat/spectate/reconnect.
-- lobby_runs is the anchor for any lobby type (matchmaking/private/practice);
-- match_run_logs holds one compressed (gzip+base64) block per (run, player),
-- fed by the server's MQTT buffer over the game_log_event ActionType stream.
CREATE TABLE IF NOT EXISTS "lobby_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lobby_code" varchar(6) NOT NULL,
	"mod_id" varchar(128) NOT NULL,
	"lobby_type" varchar(16) NOT NULL,
	"matchmaking_match_id" varchar(36),
	"status" varchar(16) NOT NULL DEFAULT 'active',
	"started_at" timestamp with time zone NOT NULL DEFAULT now(),
	"finalized_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "lobby_runs_lobby_code_idx" ON "lobby_runs" ("lobby_code");

CREATE TABLE IF NOT EXISTS "match_run_logs" (
	"run_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"compressed_events" text NOT NULL,
	"carbon_hash" text,
	"event_count" integer NOT NULL DEFAULT 0,
	"status" varchar(16) NOT NULL DEFAULT 'partial',
	"finalized_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "match_run_logs_run_id_player_id_pk" PRIMARY KEY("run_id", "player_id")
);

DO $$ BEGIN
	ALTER TABLE "match_run_logs" ADD CONSTRAINT "match_run_logs_run_id_lobby_runs_id_fk"
		FOREIGN KEY ("run_id") REFERENCES "public"."lobby_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
