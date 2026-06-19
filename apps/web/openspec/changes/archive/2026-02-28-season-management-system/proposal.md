## Why

Adding a new season requires touching ~8 places in code: hardcoded dates in `seasons.ts`, a new Zod enum value, per-season leaderboard methods, cache wiring, and frontend selectors. Historical leaderboard data is scattered across static JSON files, a DB table, and a live bot API with no unified management surface.

## What Changes

- **BREAKING**: Replace hardcoded `SeasonSchema` Zod enum with dynamic DB-backed season config; `SeasonSchema` becomes `z.string().regex(/^season\d+$/)`
- Add `seasons` table as single source of truth for season dates, names, and active status
- Add `season_snapshots` table referencing MinIO-stored leaderboard JSON per (season, queue)
- Replace per-season leaderboard methods (`getSeason1()`…`getSeason6()`) with single `getSeasonLeaderboard(seasonId, queueId)`
- Historical season leaderboards: permanently cached in Redis (no TTL), source from MinIO
- Active season leaderboard: unchanged (bot API, Redis 180s TTL)
- New owner-only admin UI at `/admin/seasons` to manage seasons and snapshots
- Cache invalidation available per (season, queue) from admin UI

## Capabilities

### New Capabilities

- `season-config`: DB-backed season configuration (id, name, start/end dates, active flag)
- `leaderboard-snapshots`: Per-(season, queue) leaderboard snapshot management — upload JSON to MinIO, reference from DB, serve via Redis cache with no TTL
- `season-admin-ui`: Owner-only admin pages to create/edit seasons, upload snapshots, and invalidate Redis cache

### Modified Capabilities

<!-- No existing spec files — all new -->

## Impact

- `src/shared/seasons.ts` — hardcoded dates and Zod enum replaced
- `src/server/services/leaderboard.ts` — per-season methods consolidated
- `src/server/db/schema.ts` — two new tables
- `src/server/api/routers/leaderboard.ts` — season routing simplified
- `src/app/(home)/leaderboards/page.tsx` + `src/app/_components/leaderboard.tsx` — season list from DB
- `src/app/(home)/stats/` — season list from DB
- New admin pages under `src/app/(home)/admin/seasons/`
- New MinIO bucket prefix: `leaderboard-snapshots/`
- Redis key space: `leaderboard:s{N}:{queueId}` (historical no-TTL) + existing `leaderboard:s{N}:{queueId}:live` pattern for active
