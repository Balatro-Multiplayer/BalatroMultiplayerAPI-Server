## Why

Game data is buried inside `parsedJson` blobs on 42k+ log files. No way to search, filter, or browse individual games across the system. Admins need to discover games by player, deck, joker, connection ID, etc.

## What Changes

- New `games` table denormalizing individual games from `logFiles.parsedJson`
- Backfill script to populate from existing 42k+ log files
- Update log upload flow (`PUT /api/logs/upload`) to also insert into `games`
- New API endpoint `GET /api/games` with full search/filter/sort/pagination
- New admin page at `/admin/games` with searchable paginated table
- Log parser gains `game` query param support for deep linking to a specific game tab

## Capabilities

### New Capabilities
- `games-table`: Denormalized games DB table with schema, backfill script, and insert-on-upload hook
- `games-discovery-ui`: Admin page with searchable/filterable/sortable paginated table of all games
- `log-parser-deep-link`: Query param support in log parser for selecting a specific game tab

### Modified Capabilities

_(none — no existing spec requirements change)_

## Impact

- **DB**: New `games` table + migration, multiple indexes
- **API**: New `GET /api/games` route, modified `PUT /api/logs/upload`
- **UI**: New `/admin/games` page, modified `/log-parser` page
- **Data**: One-time backfill of ~100k+ game rows from existing logs
