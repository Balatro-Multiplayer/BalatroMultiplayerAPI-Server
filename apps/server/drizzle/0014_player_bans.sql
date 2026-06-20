-- Three-tier moderation bans (chat / queue / account). One row per ban;
-- a player may hold several active bans of different types at once.
-- Active = lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()).
CREATE TABLE IF NOT EXISTS "player_bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"ban_type" text NOT NULL,
	"expires_at" timestamp with time zone,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL DEFAULT now(),
	"reason" text NOT NULL DEFAULT '',
	"lifted_at" timestamp with time zone,
	"lifted_by" text
);

DO $$ BEGIN
	ALTER TABLE "player_bans" ADD CONSTRAINT "player_bans_player_id_players_id_fk"
		FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "player_bans_player_idx" ON "player_bans" ("player_id");
