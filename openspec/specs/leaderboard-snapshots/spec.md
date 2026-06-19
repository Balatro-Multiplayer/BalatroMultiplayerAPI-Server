## Purpose

Define storage and serving behavior for season leaderboard snapshots.

## Requirements

### Requirement: Snapshot metadata stored in database
For each past season and queue combination, a `season_snapshots` table row SHALL store the MinIO object key, uploader identity, and creation timestamp. Only one snapshot per (seasonId, queueId) pair SHALL exist at a time.

#### Scenario: Snapshot record created after upload
- **WHEN** an owner uploads a leaderboard JSON file for season N, queue Q
- **THEN** a row is inserted into `season_snapshots` with the correct seasonId, queueId, minioKey, and uploadedBy fields

#### Scenario: Duplicate upload replaces existing record
- **WHEN** an owner uploads a new snapshot for a (season, queue) that already has one
- **THEN** the old MinIO object is deleted, the old DB record is replaced, and the Redis cache key for that (season, queue) is invalidated

### Requirement: Leaderboard JSON stored in MinIO
Snapshot JSON files SHALL be uploaded to MinIO under the prefix `leaderboard-snapshots/season{N}/{queueId}-{timestamp}.json` within the dedicated `MINIO_LEADERBOARD_BUCKET_NAME` bucket.

#### Scenario: File stored at correct path
- **WHEN** a snapshot is uploaded for season 4, queue `ranked`
- **THEN** the MinIO object key matches `leaderboard-snapshots/season4/ranked-{timestamp}.json`

#### Scenario: Upload failure does not create DB record
- **WHEN** the MinIO upload fails
- **THEN** no `season_snapshots` row is created and the error is surfaced to the caller

### Requirement: Historical leaderboard served from Redis or MinIO
When a leaderboard request is made for a non-active season, the system SHALL:
1. Check Redis for key `leaderboard:s{N}:{queueId}`
2. On cache hit, return parsed data immediately
3. On cache miss, fetch JSON from MinIO using the key from `season_snapshots`
4. Store fetched data in Redis with no TTL
5. Return the data

#### Scenario: Cache hit
- **WHEN** the Redis key exists for a past season
- **THEN** the leaderboard data is returned without querying MinIO or DB

#### Scenario: Cache miss with snapshot available
- **WHEN** the Redis key is absent and a `season_snapshots` row exists
- **THEN** data is fetched from MinIO, stored in Redis (no TTL), and returned

#### Scenario: No snapshot uploaded yet
- **WHEN** the Redis key is absent and no `season_snapshots` row exists for the (season, queue)
- **THEN** the system falls back to the legacy loader (static file or `leaderboard_snapshots` table) and returns whatever data is available, or an empty result

### Requirement: Active season leaderboard unchanged
For the currently active season, the system SHALL continue fetching from the bot API and caching in Redis with a 180-second TTL, using key `leaderboard:s{N}:{queueId}`.

#### Scenario: Active season request
- **WHEN** a leaderboard request is made for the active season
- **THEN** data is served from Redis if present (TTL 180s), otherwise fetched from bot API and cached

### Requirement: Cache invalidatable per (season, queue)
An owner SHALL be able to invalidate the Redis cache for any (season, queue) combination from the admin UI, causing the next request to re-fetch from MinIO.

#### Scenario: Cache invalidated
- **WHEN** an owner clicks "Invalidate Cache" for season N, queue Q in the admin UI
- **THEN** the Redis key `leaderboard:s{N}:{queueId}` is deleted
- **AND** the next leaderboard request for that combination re-fetches from MinIO and re-populates the cache
