-- Appeals of punishments and network bans, and a lift mark on warnings so a granted appeal can lift one.
ALTER TABLE "player_warnings" ADD COLUMN IF NOT EXISTS "lifted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_warnings" ADD COLUMN IF NOT EXISTS "lifted_by" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL REFERENCES "players"("id"),
	"target_kind" varchar(16) NOT NULL,
	"punishment_id" uuid,
	"network_ban_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"decision_reason" text,
	"outcome" varchar(16),
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appeals_player_idx" ON "appeals" ("player_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appeals_punishment_idx" ON "appeals" ("punishment_id");
