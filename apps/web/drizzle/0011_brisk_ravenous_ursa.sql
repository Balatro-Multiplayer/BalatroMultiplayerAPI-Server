UPDATE "user"
SET "permissions" = array_append("permissions", 'transcripts.search')
WHERE array_position("permissions", 'transcripts.view') IS NOT NULL
  AND array_position("permissions", 'transcripts.search') IS NULL;
