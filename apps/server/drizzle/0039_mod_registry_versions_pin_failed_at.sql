-- Tracks a mod_registry_versions row that backfill-branch-pins.ts gave up on
-- permanently resolving to a commit-pinned downloadUrl (see that script and
-- mods-sync.service.ts's pinBranchVersionIfNew) after exhausting its
-- retries within a run. Null means "never permanently failed" -- either
-- already pinned (downloadUrl no longer classifies as 'branch') or not
-- attempted yet. Lets a re-run of the backfill skip known-dead rows by
-- default instead of re-spending GitHub API calls on them every time.
ALTER TABLE "mod_registry_versions" ADD COLUMN "pin_failed_at" timestamp with time zone;
