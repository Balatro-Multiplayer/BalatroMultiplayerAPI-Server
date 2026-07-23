-- Players are soft-deleted, never hard-deleted, so ban history survives
-- account deletion (fixes a ban-evasion exploit where deleting your account
-- cascade-deleted your own ban records). deleted_at is set at deletion time;
-- steam_id_hash is retained until a later retention job purges it (only once
-- no ban is active). Null deleted_at = active account.
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- Drop the cascade so a hard-delete of a players row can no longer silently
-- wipe ban history. Defense in depth: the account-deletion path no longer
-- hard-deletes players at all, but this stops any other/future code path
-- from doing so unnoticed.
ALTER TABLE "player_bans" DROP CONSTRAINT IF EXISTS "player_bans_player_id_players_id_fk";

DO $$ BEGIN
	ALTER TABLE "player_bans" ADD CONSTRAINT "player_bans_player_id_players_id_fk"
		FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON UPDATE NO ACTION;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
