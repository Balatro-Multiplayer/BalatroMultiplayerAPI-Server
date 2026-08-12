-- Adds an admin-owned "featured" highlight flag (same "never synced from the
-- index" shape as allowed_in_ranked/ranked_version) and overridden_fields, a
-- text[] recording which of a mod's syncable fields (title, description,
-- thumbnail_url, etc.) an admin has directly edited via
-- PATCH /api/webadmin/mods/:modId -- upsertModFromIndex skips a field named
-- here on every future sync until an admin reverts it via
-- POST /api/webadmin/mods/:modId/reset-overrides.
ALTER TABLE "mod_registry" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;
ALTER TABLE "mod_registry" ADD COLUMN "overridden_fields" text[] DEFAULT '{}' NOT NULL;
