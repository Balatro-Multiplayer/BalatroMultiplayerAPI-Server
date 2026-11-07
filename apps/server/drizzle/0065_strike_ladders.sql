-- Strikes on the chat and play ladders, and the admin-edited ladder steps.
ALTER TABLE "server_config" ADD COLUMN IF NOT EXISTS "chat_ladder_steps" jsonb;--> statement-breakpoint
ALTER TABLE "server_config" ADD COLUMN IF NOT EXISTS "play_ladder_steps" jsonb;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL REFERENCES "players"("id"),
	"ladder" varchar(8) NOT NULL,
	"ban_id" uuid REFERENCES "player_bans"("id"),
	"warning_id" uuid REFERENCES "player_warnings"("id"),
	"recommended_step" varchar(16) NOT NULL,
	"applied_step" varchar(16) NOT NULL,
	"deviation_reason" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_strikes_player_idx" ON "player_strikes" ("player_id", "ladder");
