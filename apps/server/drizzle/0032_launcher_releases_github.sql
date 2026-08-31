-- Switches launcher release hosting from "this server stores the binary on
-- local disk" to "this server references the asset on the private
-- new-launcher repo's own GitHub Release" -- see schema.ts's launcherReleases
-- doc comment for why. storage_path (a local disk path) is replaced by
-- github_asset_id (GitHub's own numeric release-asset id); launcher_release
-- gains github_release_tag so the admin UI can re-resolve a release without
-- the admin re-typing which tag it came from.
--
-- Existing rows point at binaries on local disk that have no GitHub-side
-- equivalent to backfill from -- dropped and re-imported via the admin UI's
-- new "select a GitHub release" flow, not migrated in place.
DELETE FROM "launcher_release_asset";
DELETE FROM "launcher_release";

ALTER TABLE "launcher_release" ADD COLUMN "github_release_tag" varchar(128) NOT NULL;

ALTER TABLE "launcher_release_asset" ADD COLUMN "github_asset_id" integer NOT NULL;
ALTER TABLE "launcher_release_asset" DROP COLUMN "storage_path";
