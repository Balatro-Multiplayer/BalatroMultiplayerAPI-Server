ALTER TABLE "user" ADD COLUMN "permissions" text[] DEFAULT ARRAY[]::text[] NOT NULL;

UPDATE "user"
SET "permissions" = ARRAY[
  'moderation.view',
  'moderation.strikes.manage',
  'transcripts.view'
]::text[]
WHERE "role" = 'helper';

UPDATE "user"
SET "permissions" = ARRAY[
  'moderation.view',
  'moderation.strikes.manage',
  'moderation.bans.manage',
  'blog.manage',
  'logs.manage',
  'logs.download_original',
  'games.view',
  'releases.manage',
  'obs_control.manage',
  'transcripts.view',
  'leaderboard.snapshots.view'
]::text[]
WHERE "role" = 'admin';

UPDATE "user"
SET "permissions" = ARRAY[
  'permissions.manage',
  'seasons.manage',
  'moderation.view',
  'moderation.strikes.manage',
  'moderation.bans.manage',
  'blog.manage',
  'logs.manage',
  'logs.download_original',
  'games.view',
  'releases.manage',
  'obs_control.manage',
  'transcripts.view',
  'leaderboard.snapshots.view'
]::text[]
WHERE "role" = 'owner';
