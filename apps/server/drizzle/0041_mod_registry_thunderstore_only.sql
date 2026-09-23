-- Switches the mod catalog to Thunderstore as its only source while keeping
-- every field the launcher already reads (GET /api/mods, /api/mods/:id,
-- /api/mods/profiles). Drops the second, GitHub-sourced index and the admin
-- "custom mod" / per-field-override machinery built around it.
--
-- Existing rows are kept, not truncated: the next sync claims each one for
-- its Thunderstore package (by repo URL, or an explicit alias for the few
-- ids the launcher hardcodes -- see mod-registry-claims.ts), keeping the
-- legacy id, title, featured/hidden and ranked pin. Rows no package claims
-- are pruned by that sync. Carried-over ranked pins are re-hashed against
-- Thunderstore's archive, or cleared if that version isn't on Thunderstore.

-- Profiles are kept read-only. Dropping the FK means a pruned mod can never
-- cascade away profile entries.
ALTER TABLE "mod_profile_entries" DROP CONSTRAINT IF EXISTS "mod_profile_entries_mod_id_fkey";

-- Steamodded's GitHub tag "1.0.0-beta-1620a" is published on Thunderstore as
-- "1.1620.0".
UPDATE "mod_profile_entries" AS e
SET "pinned_version" = '1.1620.0'
FROM "mod_profiles" AS p
WHERE e."profile_id" = p."id"
	AND p."slug" = 'mppvp'
	AND e."mod_id" = 'smods'
	AND e."version_mode" = 'exact'
	AND e."pinned_version" = '1.0.0-beta-1620a';

-- Every stored version row points at a GitHub URL; the sync repopulates this
-- table from Thunderstore.
TRUNCATE TABLE "mod_registry_versions";
ALTER TABLE "mod_registry_versions" DROP COLUMN "sha256";
ALTER TABLE "mod_registry_versions" DROP COLUMN "pin_failed_at";
ALTER TABLE "mod_registry_versions" ADD COLUMN "dependencies" text[] DEFAULT '{}' NOT NULL;

ALTER TABLE "mod_registry" DROP COLUMN "latest_sha256";
ALTER TABLE "mod_registry" DROP COLUMN "is_custom";
ALTER TABLE "mod_registry" DROP COLUMN "automatic_version_check";
ALTER TABLE "mod_registry" DROP COLUMN "fixed_release_tag_updates";
ALTER TABLE "mod_registry" DROP COLUMN "overridden_fields";
ALTER TABLE "mod_registry" DROP COLUMN "index_source";
ALTER TABLE "mod_registry" DROP COLUMN "search_terms";
DROP TYPE IF EXISTS "mod_index_source";

ALTER TABLE "mod_registry" ADD COLUMN "thunderstore_full_name" varchar(128);
ALTER TABLE "mod_registry" ADD CONSTRAINT "mod_registry_thunderstore_full_name_unique" UNIQUE ("thunderstore_full_name");
ALTER TABLE "mod_registry" ADD COLUMN "package_url" text;
ALTER TABLE "mod_registry" ADD COLUMN "donation_link" text;
ALTER TABLE "mod_registry" ADD COLUMN "ranked_version_sha256" varchar(64);
