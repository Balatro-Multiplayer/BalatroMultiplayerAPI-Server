-- Whether Nakama has told the ranked players how a season ended. Seasons that
-- already ended count as told, so only later ones are announced.
ALTER TABLE "seasons" ADD COLUMN IF NOT EXISTS "end_notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "seasons" SET "end_notified_at" = now() WHERE "ended_at" IS NOT NULL AND "end_notified_at" IS NULL;
