## 1. Database Schema & Migration

- [x] 1.1 Add `games` table to drizzle schema (`src/server/db/schema.ts`) with all columns, indexes, and unique constraint on `(logFileId, gameIndex)`
- [x] 1.2 Generate and run drizzle migration

## 2. Extraction Utilities

- [x] 2.1 Add `extractConnectionId` and `extractEncryptId` helper functions to `src/lib/log-file-players.ts` (regex on mods arrays)
- [x] 2.2 Add `extractGameRows` function that takes parsedJson array + logFileId and returns insertable game rows

## 3. Backfill Script

- [x] 3.1 Create `scripts/backfill-games.ts` — iterate all logFiles, extract games, batch upsert into games table with progress logging, call `process.exit()` on completion

## 4. Upload Hook

- [x] 4.1 Update `PUT /api/logs/upload` to delete+insert games rows inside the existing transaction when parsedJson is saved

## 5. Games API

- [x] 5.1 Create `GET /api/games/route.ts` with auth check, pagination, free-text search across all searchable fields, dropdown filters (deck, stake, winner, ruleset), and sortable columns

## 6. Admin Games Page

- [x] 6.1 Create `/admin/games/page.tsx` server component with auth guard
- [x] 6.2 Create `/admin/games/games-client.tsx` client component with: search input (debounced 400ms), dropdown filters, sortable table, pagination, URL state via `nuqs`
- [x] 6.3 Wire up table columns: all game fields, winner resolved to actual name, jokers/vouchers as badges, stake displayed as name, duration formatted, action link to log parser

## 7. Log Parser Deep Link

- [x] 7.1 Add `game` query param support to log parser page — controlled `Tabs` with initial value from param, fallback to first tab
