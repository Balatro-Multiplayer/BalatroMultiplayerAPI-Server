-- Ranked eligibility overrides are now entirely admin/DB-owned -- BETModIndex
-- publishes a pure base index with no override layer of its own anymore, so
-- there's nothing left for allowed_in_ranked_source to distinguish ('index'
-- vs 'manual'). Adds a ranked-version pin (null = any version of a
-- ranked-allowed mod is fine) and a flag for admin-created mods with no
-- base-index counterpart, so the sync's prune step can skip them.
ALTER TABLE "mod_registry" DROP COLUMN "allowed_in_ranked_source";
ALTER TABLE "mod_registry" ADD COLUMN "ranked_version" varchar(64);
ALTER TABLE "mod_registry" ADD COLUMN "is_custom" boolean DEFAULT false NOT NULL;
