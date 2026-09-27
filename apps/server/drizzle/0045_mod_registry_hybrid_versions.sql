-- Thunderstore + GitHub hybrid catalog (new-launcher THUNDERSTORE_MIGRATION_PLAN.md):
-- per-version source and aliases, a permanent ranked download URL stored
-- with its hash, a pin health flag instead of automatic pin clearing, and a
-- per-mod "also track GitHub" switch.
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "ranked_download_url" text;
--> statement-breakpoint
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "ranked_source" varchar(16);
--> statement-breakpoint
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "ranked_download_status" varchar(16);
--> statement-breakpoint
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "ranked_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "track_github" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mod_registry_versions" ADD COLUMN IF NOT EXISTS "source" varchar(16) DEFAULT 'thunderstore' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mod_registry_versions" ADD COLUMN IF NOT EXISTS "aliases" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mod_registry_versions" ADD COLUMN IF NOT EXISTS "ref" text;
--> statement-breakpoint
-- A custom mod's versions are all GitHub-side (or an admin raw URL).
UPDATE "mod_registry_versions" SET "source" = 'github'
WHERE "mod_id" IN (SELECT "id" FROM "mod_registry" WHERE "is_custom");
--> statement-breakpoint
-- Existing pins have no permanent URL yet, and Thunderstore pins were hashed
-- through the old flatten rather than as shipped. Leaving
-- ranked_download_url null makes the next sync resolve and re-hash every
-- existing pin; the old hash stays served until the new one is stored.
UPDATE "mod_registry" SET "ranked_download_url" = NULL, "ranked_source" = NULL
WHERE "ranked_version" IS NOT NULL;
