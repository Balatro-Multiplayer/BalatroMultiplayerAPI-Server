-- Restores admin-created custom mods (rows with no Thunderstore package)
-- alongside the Thunderstore-synced ones. 0041 dropped these columns when the
-- registry went Thunderstore-only; only the columns custom mods need come
-- back (no per-field overrides, no index_source -- there is still exactly
-- one upstream index, and it never writes a custom row). See schema.ts's
-- comments on mod_registry.is_custom and friends.
--
-- IF NOT EXISTS so a database that still carries these columns from before
-- 0041's drop (or a re-run) is a no-op rather than an error.
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "is_custom" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "automatic_version_check" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "fixed_release_tag_updates" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mod_registry" ADD COLUMN IF NOT EXISTS "search_terms" text[] DEFAULT '{}' NOT NULL;
