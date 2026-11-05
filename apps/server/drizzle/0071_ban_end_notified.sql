-- Whether Nakama has told the player their ban ended. Every ban already over
-- (expired or lifted) when this runs counts as told, so only bans that end
-- after the deploy are announced.
ALTER TABLE "player_bans" ADD COLUMN IF NOT EXISTS "end_notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "player_bans" SET "end_notified_at" = now() WHERE "end_notified_at" IS NULL AND ("lifted_at" IS NOT NULL OR ("expires_at" IS NOT NULL AND "expires_at" <= now()));
--> statement-breakpoint
-- The same for appeals: Nakama is told of each decision until it confirms.
-- Appeals already decided count as told.
ALTER TABLE "appeals" ADD COLUMN IF NOT EXISTS "notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "appeals" SET "notified_at" = now() WHERE "notified_at" IS NULL AND "status" <> 'open';
