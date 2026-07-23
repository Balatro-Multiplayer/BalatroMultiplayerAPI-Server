-- Self-service player mutes: muter_id suppresses muted_id's chat messages on
-- the muter's own client (never enforced server-side). One row per mute pair.
CREATE TABLE IF NOT EXISTS "player_mutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"muter_id" uuid NOT NULL,
	"muted_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$ BEGIN
	ALTER TABLE "player_mutes" ADD CONSTRAINT "player_mutes_muter_id_players_id_fk"
		FOREIGN KEY ("muter_id") REFERENCES "public"."players"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "player_mutes" ADD CONSTRAINT "player_mutes_muted_id_players_id_fk"
		FOREIGN KEY ("muted_id") REFERENCES "public"."players"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "player_mutes_pair_idx" ON "player_mutes" ("muter_id","muted_id");
CREATE INDEX IF NOT EXISTS "player_mutes_muter_idx" ON "player_mutes" ("muter_id");
