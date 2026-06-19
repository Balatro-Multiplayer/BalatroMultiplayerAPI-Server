## Context

Current state: season configuration is entirely hardcoded in `src/shared/seasons.ts` (dates as constants, seasons as a Zod enum). Leaderboard data for past seasons lives across static JSON files (S1, S2, S4), a `leaderboard_snapshots` DB table (S3), and a live bot API (S5, S6). Adding a new season requires touching 8+ files. There is no UI for season management.

MinIO is already integrated (`src/server/minio.ts`) with `uploadFile()` helper. Redis is already integrated (`src/server/redis.ts`). An `ownerProcedure` tRPC guard exists. Admin page patterns are established at `src/app/(home)/admin/`.

## Goals / Non-Goals

**Goals:**
- Single source of truth for season config in DB
- Unified leaderboard loading path regardless of season age
- MinIO-backed snapshot storage with DB references
- Permanent Redis cache for historical leaderboard data with admin invalidation
- Owner-only admin UI for season and snapshot management
- Zero code changes required to add future seasons

**Non-Goals:**
- Bot integration (season reset, queue management) — deferred
- Migrating S1–S4 static JSON data automatically (owners upload via UI)
- Changing URL param format from `season{N}` to numeric

## Decisions

### D1: Seasons table in balatro-mp DB (not bot DB)

**Decision**: Add `seasons` table to balatro-mp's PostgreSQL via Drizzle.

**Rationale**: Bot scope is explicitly excluded. The main app is the display layer; it owns the canonical season metadata for the site. Bot keeps its own `active_season` in `settings` — these remain independent until a future integration.

**Alternative considered**: Shared DB table between both apps. Rejected because it couples the two systems prematurely.

---

### D2: `season_snapshots` rows serve dual purpose: queue registration + historical data ref

**Decision**: `season_snapshots` rows exist for every (season, queueType) pair, including the active season. For the active season, `minioKey` is null — the row is a queue registration only (defines queueType label + queueId for bot API routing). For past seasons, `minioKey` points to the uploaded end-of-season JSON in MinIO.

Active season leaderboard data lives **exclusively in Redis** (180s TTL, refreshed by webhook). There is no MinIO file for the active season. The owner uploads the canonical end-of-season JSON manually when closing a season — this is the official record, not an automated snapshot.

Schema:
```
season_snapshots {
  seasonId   FK → seasons.id
  queueType  text  -- human label and URL param: 'ranked', 'smallworld', etc.
  queueId    text  -- actual ID forwarded to bot API or used as MinIO prefix
  minioKey   text nullable  -- null = active/live, set = historical archive
  uploadedBy text nullable
  createdAt  timestamp
  UNIQUE(seasonId, queueType)
}
```

**Rationale**: Active season data changes multiple times per minute (every match). Storing it to MinIO would be stale immediately. Redis at 180s TTL is sufficient and already refreshed by webhooks. MinIO is for immutable end-of-season archives only.

**Alternative considered**: Periodic MinIO snapshots for active season. Rejected — data would be constantly outdated and creates unnecessary write load.

**Alternative considered**: Inline JSON in DB (like existing `leaderboard_snapshots` table). Rejected — snapshots can be 100KB–1MB+; DB is not the right store for large blobs.

---

### D3: Redis as permanent cache for historical snapshots

**Decision**: `SET leaderboard:s{N}:{queueId}` with no TTL for past seasons.

**Rationale**: Historical leaderboard data never changes. TTL would cause unnecessary MinIO re-fetches. Admin UI provides manual invalidation escape hatch if data is re-uploaded or corrected.

**Active season key**: `season:{N}:leaderboard:{queueId}` with EX 180 (preserve existing key format, just make N dynamic).

---

### D6b: `refreshLeaderboard()` resolves active season from DB, not hardcode

**Decision**: Active season number is cached in Redis under key `config:active_season` (no TTL). `getActiveSeasonNumber()` reads from Redis only. DB is the source of truth but never hit on the hot path.

**Write path**: When admin calls `seasons.update` to set a season active, the mutation writes to DB then calls `redis.set('config:active_season', N)` immediately.

**Read path**: `getActiveSeasonNumber()` calls `redis.get('config:active_season')`. On cold start / cache miss, falls back to DB and re-populates Redis.

**Rationale**: `active_season` is read in many hot paths — leaderboard default, stats season selectors, user games default, `refreshLeaderboard()` webhook, etc. Even a cheap DB query multiplied across all daily match activity adds up. Redis is already required infrastructure and a single string GET is effectively free. The value changes at most a few times a year.

**Alternative considered**: Direct DB query per request. Rejected — too many daily reads for a value that almost never changes.

**Alternative considered**: `unstable_cache` (Next.js). Rejected — doesn't work in API route / webhook context, only in RSC.

---

### D4: `SeasonSchema` becomes loose regex, seasons loaded from DB

**Decision**: Replace `z.enum([...])` with `z.string().regex(/^season\d+$/)`. `getSeasonForDate()` becomes async, reading season config from Redis key `config:seasons` and falling back to DB on cache miss.

**Rationale**: Enum can't represent an open-ended set of seasons. Redis keeps the cache usable from RSC, API routes, scripts, and webhooks with one shared code path. Season config changes rarely, so a persistent Redis entry is a better fit than framework-local caching.

**Alternative considered**: Numeric season IDs in URLs. Rejected to avoid breaking existing bookmarks.

**Alternative considered**: `unstable_cache` (Next.js). Rejected — cache scope is tied to Next.js runtime semantics and is not a good fit for scripts, webhooks, or non-RSC consumers.

---

### D5: Old per-season leaderboard methods replaced, not wrapped

**Decision**: Delete `getSeason1()`…`getSeason6()` and replace with single `getSeasonLeaderboard(seasonId: number, queueType: string)`. Method looks up the `season_snapshots` row to get `queueId` and `minioKey`, then routes accordingly.

**Rationale**: Wrapping would leave dead code. The new method covers all cases via the snapshot row: active (minioKey null → bot API via queueId) and historical (minioKey set → Redis no-TTL → MinIO). The legacy `leaderboard_snapshots` table is queried as a final fallback for S3 data until uploaded to MinIO.

**Redis cold start handling**: On cache miss for active season, fall back to bot API fetch and re-cache at 180s TTL — same as current `loadSeason6Data()` cache-miss path.

---

### D6: Dedicated MinIO bucket for leaderboard snapshots

**Decision**: Store snapshot files at `leaderboard-snapshots/season{N}/{queueType}-{timestamp}.json` within a dedicated `MINIO_LEADERBOARD_BUCKET_NAME` bucket. `queueType` (not `queueId`) used in path for human readability.

**Rationale**: The existing `MINIO_BUCKET_NAME` bucket is already used for unrelated assets. A dedicated leaderboard bucket avoids mixing lifecycle and access concerns.

### D7: Leaderboard tabs driven by season_snapshots, no hardcoded queue types

**Decision**: The leaderboard page fetches available queue types for the selected season from `season_snapshots` rows. Tabs and channel routing use this data — no hardcoded `isOldSeason`, `OLD_RANKED_CHANNEL`, `RANKED_QUEUE_ID`, etc. in the leaderboard components.

**Queue metadata cached in Redis**: `config:season:{N}:queues` → JSON array of `{queueType, queueId, hasSnapshot}`. No TTL, invalidated when admin creates/deletes a snapshot row for that season.

**Auto-creation on new season**: When admin creates a new season, `season_snapshots` rows are auto-created by copying queueType + queueId definitions from the previous season (minioKey null). Owner can add/remove/edit queue entries via admin UI after creation.

**Rationale**: Removes all hardcoded queue lists from frontend. Adding a new queue type to a season requires no code change — owner adds it in admin UI. Constants (`OLD_RANKED_CHANNEL`, etc.) become seed data only, referenced once during initial DB population.

## Risks / Trade-offs

**Risk**: `getSeasonForDate()` going async breaks callers that expect sync.
→ Mitigation: Keep lookup behind a small server helper backed by Redis so callers only add `await`, and audit all call sites before shipping.

**Risk**: Historical S1–S4 data unavailable until owner manually uploads snapshots.
→ Mitigation: Fall back to legacy static JSON files and `leaderboard_snapshots` table as before during the transition. Display a "snapshot not yet uploaded" state in admin UI.

**Risk**: Redis key collision between old caching keys (e.g., existing S5/S6 patterns) and new standardized keys.
→ Mitigation: Audit existing Redis key patterns in `leaderboard.ts` before deploying. Flush affected keys on deploy if needed.

**Risk**: MinIO upload fails mid-upload, leaving DB record pointing to missing object.
→ Mitigation: Write DB record only after MinIO upload confirms success. Add object-existence check in leaderboard loader before serving.

## Migration Plan

1. Run Drizzle migration to add `seasons` and `season_snapshots` tables
2. Seed `seasons` table with S1–S6 config (start dates from existing constants), mark S6 active
3. Deploy updated leaderboard service — falls back to legacy paths if no snapshot found
4. Owner uploads S1–S4 snapshots via admin UI at their own pace
5. Once all snapshots uploaded, legacy static file fallback can be removed in a follow-up

**Rollback**: `seasons` and `season_snapshots` tables can be dropped without affecting existing data. Legacy leaderboard methods remain as commented-out backup until confirmed stable.

## Open Questions

- Should season create/update mutations always rewrite `config:seasons` immediately, or is deleting the key and letting the next read repopulate it sufficient?
- Should the admin UI enforce that a season must have an `endDate` before allowing snapshot upload (to prevent uploading for a still-active season)?
- Keep or drop the old `leaderboard_snapshots` table in this change, or leave for a future cleanup?
