## Context

Game data lives inside `logFiles.parsedJson` as arrays of `Game` objects. With 42k+ log files, querying individual games requires loading and parsing JSON blobs in application code — no DB-level search, sort, or pagination is possible. The existing admin logs page shows log files, not games.

The codebase uses:
- Drizzle ORM + Postgres
- Next.js App Router (server components + client components fetching from API routes)
- `nuqs` for URL query state
- Shared components: `TableShell`, `PaginationControls`, `SortableHeader`, shadcn `Table`

## Goals / Non-Goals

**Goals:**
- Denormalized `games` table enabling DB-level queries on all game fields
- Backfill existing data, insert on future uploads
- Admin page with rich search/filter/sort/pagination
- Deep link from games table → log parser with correct game tab selected

**Non-Goals:**
- Removing `parsedJson` from `logFiles` (kept for backward compat)
- Real-time updates / websocket notifications
- Public-facing games page (admin only)
- Storing `pvpBlinds` or `events` in games table (link to log parser instead)

## Decisions

### 1. Flat `games` table over JSON queries
**Choice**: Denormalize into a real table with typed columns and indexes.
**Alternative**: Postgres JSON operators (`->`, `->>`, `@>`) on `parsedJson`.
**Rationale**: 100k+ games, need fast text search across multiple fields, proper sorting, and pagination. JSON queries would be slow and index-unfriendly at this scale.

### 2. host/guest columns over logOwner/opponent for IDs
**Choice**: Store `hostConnectionId`, `guestConnectionId`, `hostEncryptId`, `guestEncryptId`.
**Alternative**: `logOwnerConnectionId` / `opponentConnectionId`.
**Rationale**: host/guest is absolute — the same physical player has the same connectionID regardless of who uploaded the log. `isHost` column allows deriving the logOwner perspective when needed.

### 3. Jokers/vouchers as JSON columns with text search
**Choice**: Store as `json` (string arrays), search via `::text ILIKE '%name%'`.
**Rationale**: Simple, works at this scale, avoids a join table. Full-text search on JSON cast is fast enough with 100k rows.

### 4. Backfill as standalone script, not migration
**Choice**: Separate `scripts/backfill-games.ts` run via `bun`.
**Alternative**: Run in drizzle migration.
**Rationale**: Backfill is slow (42k rows to parse), shouldn't block migrations. Can be re-run safely. Script uses batch inserts with conflict handling.

### 5. Free-text search across multiple fields
**Choice**: Single search input that queries: host, guest, hostConnectionId, guestConnectionId, hostEncryptId, guestEncryptId, seed, deck, jokers (cast to text), vouchers (cast to text).
**Alternative**: Separate search fields per column.
**Rationale**: Matches existing logs page UX. Dropdown filters handle structured fields (stake, winner, ruleset, deck).

## Risks / Trade-offs

- **Data duplication** → Games table duplicates data from parsedJson. Mitigated by inserting at upload time (single source of truth for new data) and backfill being idempotent.
- **Backfill duration** → 42k log files × multiple games each. Mitigated by batch inserts (100 at a time) and running as background script.
- **Schema drift** → If Game type changes in log parser, games table may need migration. Mitigated by only storing stable, well-understood fields.

## Migration Plan

1. Run drizzle migration to create `games` table
2. Run backfill script: `bun scripts/backfill-games.ts`
3. Deploy updated upload route (inserts into both tables)
4. Deploy admin page
