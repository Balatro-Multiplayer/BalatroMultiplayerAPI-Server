-- Simplifies the mod catalog down to a Thunderstore-only sync: drops the
-- second GitHub-sourced index, admin "custom mods", per-field overrides,
-- per-version hash history, and the unused "ranked mod profiles" concept
-- (confirmed by grep, and by its own code comments, to be completely
-- unenforced anywhere in matchmaking). mod_registry shrinks to
-- id/title/author/ranked_version/ranked_version_sha256 -- id switches from
-- the old GitHub-index slug ("Author@ModName") to the raw Thunderstore
-- full_name ("Author-ModName"), so every existing row is truncated rather
-- than migrated: no automated id-mapping backfill, an admin manually
-- re-pins ranked_version per mod post-deploy via the (now minimal) admin UI
-- once the first Thunderstore-only sync repopulates this table fresh.

DROP TABLE IF EXISTS "mod_profile_entries";
DROP TABLE IF EXISTS "mod_profiles";
DROP TYPE IF EXISTS "mod_profile_version_mode";

DROP TABLE IF EXISTS "mod_registry_versions";

TRUNCATE TABLE "mod_registry";

ALTER TABLE "mod_registry" DROP COLUMN "categories";
ALTER TABLE "mod_registry" DROP COLUMN "requires_steamodded";
ALTER TABLE "mod_registry" DROP COLUMN "requires_talisman";
ALTER TABLE "mod_registry" DROP COLUMN "repo_url";
ALTER TABLE "mod_registry" DROP COLUMN "thumbnail_url";
ALTER TABLE "mod_registry" DROP COLUMN "description";
ALTER TABLE "mod_registry" DROP COLUMN "latest_version";
ALTER TABLE "mod_registry" DROP COLUMN "latest_download_url";
ALTER TABLE "mod_registry" DROP COLUMN "latest_sha256";
ALTER TABLE "mod_registry" DROP COLUMN "featured";
ALTER TABLE "mod_registry" DROP COLUMN "hidden";
ALTER TABLE "mod_registry" DROP COLUMN "is_custom";
ALTER TABLE "mod_registry" DROP COLUMN "automatic_version_check";
ALTER TABLE "mod_registry" DROP COLUMN "fixed_release_tag_updates";
ALTER TABLE "mod_registry" DROP COLUMN "overridden_fields";
ALTER TABLE "mod_registry" DROP COLUMN "index_source";
ALTER TABLE "mod_registry" DROP COLUMN "source_updated_at";
ALTER TABLE "mod_registry" DROP COLUMN "search_terms";

ALTER TABLE "mod_registry" ADD COLUMN "ranked_version_sha256" varchar(64);

DROP TYPE IF EXISTS "mod_index_source";
