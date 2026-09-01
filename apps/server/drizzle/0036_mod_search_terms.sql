-- Admin-owned alternative search terms per mod (e.g. "wimf" for "What's in
-- my Fool") -- same "never synced from the index" shape as hidden/featured/
-- ranked_version, but editable alongside categories via the general
-- field-edit endpoint rather than its own dedicated route. See schema.ts's
-- own doc comment on mod_registry.search_terms.
ALTER TABLE "mod_registry" ADD COLUMN "search_terms" text[] DEFAULT '{}' NOT NULL;
