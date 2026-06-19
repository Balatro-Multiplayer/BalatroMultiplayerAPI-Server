## 1. Database Schema & Migration

- [x] 1.1 Add `seasons` table to `src/server/db/schema.ts` (id, name, startDate, endDate, isActive, createdAt)
- [x] 1.2 Add `season_snapshots` table to `src/server/db/schema.ts` (id, seasonId FK, queueType text, queueId text, minioKey nullable, uploadedBy nullable, createdAt, UNIQUE seasonId+queueType)
- [x] 1.3 Generate Drizzle migration with `bun drizzle-kit generate`
- [x] 1.4 Write seed migration script to insert S1–S6 rows into `seasons` table using existing date constants, mark S6 as active; seed script also sets `config:active_season` in Redis to `6`

## 2. Season Config Refactor

- [x] 2.1 Update `src/shared/seasons.ts`: replace `SeasonSchema` enum with `z.string().regex(/^season\d+$/)`, keep string format
- [x] 2.2 Make `getSeasonForDate()` async, implement using Redis-backed season config cache with DB fallback
- [x] 2.3 Update `getSeasonDisplayName()` to derive number from string dynamically (no hardcoded cases)
- [x] 2.4 Audit and update all callers of `getSeasonForDate()` and `SeasonSchema` to handle async / new type

## 3. Leaderboard Service Consolidation

- [x] 3.0 Add `getActiveSeasonNumber()` helper: reads `config:active_season` from Redis, falls back to DB on miss and re-populates Redis
- [x] 3.1 Add `getSeasonLeaderboard(seasonId: number, queueType: string)` to `src/server/services/leaderboard.ts`: look up `season_snapshots` row → if `minioKey` null: bot API via `queueId` (Redis 180s TTL); if `minioKey` set: Redis (no TTL) → MinIO → legacy fallback
- [x] 3.2 Add `getSeasonUserRank(seasonId: number, queueId: string, userId: string)` method using same data path
- [x] 3.3 Update `src/server/api/routers/leaderboard.ts` `get_leaderboard` and `get_user_rank` to call new methods; extract season number from `season{N}` string
- [x] 3.4 Update `src/server/api/routers/stats.ts` season branching (`DB_SEASONS` logic) to use DB-loaded season config
- [x] 3.5 Update `refreshLeaderboard()` in leaderboard service to call `getActiveSeasonNumber()` instead of hardcoded `6` when building the season Redis key to DEL
- [x] 3.6 Remove per-season methods `getSeason1()`…`getSeason6()` after all callers are migrated

## 4. tRPC Seasons Router

- [x] 4.1 Create `src/server/api/routers/seasons.ts` with `ownerProcedure` for all mutations
- [x] 4.2 Implement `list` query — return all seasons from DB ordered by id
- [x] 4.3 Implement `create` mutation — insert season row, auto-create `season_snapshots` rows by copying queueType+queueId from previous season (minioKey null), set `config:active_season` in Redis if isActive, refresh or invalidate `config:seasons`, cache new season's queues at `config:season:{N}:queues`
- [x] 4.4 Implement `update` mutation — update season row; when setting active=true: set all others inactive, write `config:active_season` to Redis; always refresh or invalidate `config:seasons`
- [x] 4.5 Implement `list_snapshots` query — return `season_snapshots` rows for a seasonId (cached via `config:season:{N}:queues` in Redis)
- [x] 4.6 Implement `upsert_queue` mutation — add or update a queue entry (queueType, queueId) for a season; invalidate `config:season:{N}:queues` in Redis
- [x] 4.7 Implement `upload_snapshot` mutation — upload Buffer to MinIO under `leaderboard-snapshots/season{N}/{queueType}-{ts}.json`, delete old MinIO object if replacing, set `minioKey` on DB row, DEL Redis leaderboard key `season:{N}:leaderboard:{queueId}`, invalidate `config:season:{N}:queues`
- [x] 4.8 Implement `delete_queue` mutation — remove `season_snapshots` row, delete MinIO object if exists, DEL Redis leaderboard and queue-list keys
- [x] 4.9 Implement `invalidate_cache` mutation — DEL `season:{N}:leaderboard:{queueId}` from Redis
- [x] 4.9 Register seasons router in `src/server/api/root.ts`

## 5. Admin UI — Season List Page

- [x] 5.1 Create `src/app/(home)/admin/seasons/page.tsx` — owner-only guard (redirect to `/` if not owner), fetch and display seasons table
- [x] 5.2 Implement seasons table columns: id, name, dates, active badge, snapshot count, Edit/Manage links
- [x] 5.3 Implement "New Season" modal/form with name + start date fields, calls `seasons.create` mutation

## 6. Admin UI — Season Detail Page

- [x] 6.1 Create `src/app/(home)/admin/seasons/[id]/page.tsx` — owner-only guard, load season by id
- [x] 6.2 Implement season edit form (name, startDate, endDate, isActive toggle), calls `seasons.update` mutation
- [x] 6.3 Create snapshot manager table with one row per known queue type (ranked, smallworld, vanilla, legacy)
- [x] 6.4 Implement upload control: file picker accepting `.json`, client-side parse validation, calls `seasons.upload_snapshot` mutation with file buffer
- [x] 6.5 Implement "Invalidate Cache" button per snapshot row, calls `seasons.invalidate_cache` mutation, shows toast
- [x] 6.6 Implement "Delete" button per snapshot row with confirmation, calls `seasons.delete_snapshot` mutation

## 7. Frontend Season Selectors

- [x] 7.1 Update `src/app/(home)/leaderboards/page.tsx`: read active season from `getActiveSeasonNumber()` (Redis), fetch queue list for selected season from `seasons.list_snapshots`, pass both as props to `LeaderboardPage`
- [x] 7.2 Update `src/app/_components/leaderboard.tsx`: season selector from DB list, tabs from snapshot queue entries (dynamic, no hardcoded tab values), `channelId` resolved from snapshot row's `queueId` — remove all `isOldSeason` logic and queue ID constants
- [x] 7.3 Update `src/app/(home)/stats/search-params.constants.ts` `STATS_SEASONS` to be derived from DB at request time

## 8. Environment & Infra

- [x] 8.1 Verify `MINIO_LEADERBOARD_BUCKET_NAME` env var is available; confirm snapshot uploads use the dedicated leaderboard bucket
- [x] 8.2 Run migration on staging, verify `seasons` seed data correct
- [x] 8.3 Smoke test full leaderboard load path: active season (bot API) and a past season (Redis miss → MinIO → cache)
