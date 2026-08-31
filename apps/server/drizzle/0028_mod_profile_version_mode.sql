-- Replaces mod_profile_entries.version_constraint (free-text 'any' /
-- exact-version / 'min:<version>', interpreted app-level only) with a fixed
-- three-value enum, matching the three ways a launcher profile preset can
-- actually pin a mod: an exact version string, "whatever's newest", or
-- "whatever the admins have currently marked ranked-safe" (mod_registry's
-- existing ranked_version column). pinned_version only carries a value when
-- version_mode is 'exact'. Both mod_profiles and mod_profile_entries are
-- empty in every environment (feature was never exposed publicly) -- no
-- data to convert.
CREATE TYPE "mod_profile_version_mode" AS ENUM ('exact', 'latest', 'latestRanked');

ALTER TABLE "mod_profile_entries" ADD COLUMN "version_mode" "mod_profile_version_mode" NOT NULL DEFAULT 'latest';
ALTER TABLE "mod_profile_entries" ADD COLUMN "pinned_version" varchar(64);
ALTER TABLE "mod_profile_entries" DROP COLUMN "version_constraint";
