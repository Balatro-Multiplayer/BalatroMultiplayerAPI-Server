-- Rename steam_id -> steam_id_hash and discord_id -> discord_id_hash.
-- All existing values are NULL (seeded players have no linked accounts),
-- so no data migration is required.
ALTER TABLE "players" RENAME COLUMN "steam_id" TO "steam_id_hash";
ALTER TABLE "players" RENAME COLUMN "discord_id" TO "discord_id_hash";
--> statement-breakpoint

-- Recreate unique indexes under new names
DROP INDEX IF EXISTS "players_steam_id_idx";
DROP INDEX IF EXISTS "players_discord_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_steam_id_hash_idx" ON "players" ("steam_id_hash") WHERE steam_id_hash IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_discord_id_hash_idx" ON "players" ("discord_id_hash") WHERE discord_id_hash IS NOT NULL;
--> statement-breakpoint

-- Chat opt-in columns
ALTER TABLE "players" ADD COLUMN "chat_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "players" ADD COLUMN "chat_blocked" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Extend chat_logs for moderation pipeline
ALTER TABLE "chat_logs" ADD COLUMN "moderation_id" text;
ALTER TABLE "chat_logs" ADD COLUMN "flagged" boolean NOT NULL DEFAULT false;
ALTER TABLE "chat_logs" ADD COLUMN "expires_at" timestamp with time zone;
ALTER TABLE "chat_logs" ADD COLUMN "moderation_verdict" jsonb;
