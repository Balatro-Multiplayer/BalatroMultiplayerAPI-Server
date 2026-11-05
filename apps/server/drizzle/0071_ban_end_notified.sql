-- Whether Nakama has told the player their ban ended. Bans that already ended
-- count as told, so only later ones are announced.
ALTER TABLE "player_bans" ADD COLUMN IF NOT EXISTS "end_notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "player_bans" SET "end_notified_at" = now() WHERE "end_notified_at" IS NULL AND ("lifted_at" IS NOT NULL OR ("expires_at" IS NOT NULL AND "expires_at" <= now()));
