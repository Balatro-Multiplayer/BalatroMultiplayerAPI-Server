CREATE TYPE "mod_index_source" AS ENUM ('github', 'thunderstore');
ALTER TABLE "mod_registry" ADD COLUMN "index_source" "mod_index_source";
