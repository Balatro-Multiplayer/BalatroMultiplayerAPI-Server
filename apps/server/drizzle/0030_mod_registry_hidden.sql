-- Adds an admin-owned "hidden" flag (same "never synced from the index"
-- shape as allowed_in_ranked/ranked_version/featured) that excludes a mod
-- from the public GET /api/mods catalog (launcher/website) while keeping it
-- manageable on /admin/ranked-mods -- for a mod an admin wants out of
-- players' hands without deleting it outright.
ALTER TABLE "mod_registry" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;
