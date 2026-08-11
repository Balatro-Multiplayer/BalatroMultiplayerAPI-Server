-- Opt-in automatic version-checking for admin-created custom mods (isCustom
-- rows) -- ports update_mod_versions.py's LATEST_TAG/SPECIFIC_TAG/HEAD
-- resolution to run against the server's own custom-mod rows, since these
-- have no upstream meta.json for that script to have already run against.
-- Both default false: existing custom mods keep their fully-manual
-- latestVersion/latestDownloadUrl behavior unless an admin opts in.
ALTER TABLE "mod_registry" ADD COLUMN "automatic_version_check" boolean DEFAULT false NOT NULL;
ALTER TABLE "mod_registry" ADD COLUMN "fixed_release_tag_updates" boolean DEFAULT false NOT NULL;
