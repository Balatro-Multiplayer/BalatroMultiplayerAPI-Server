## ADDED Requirements

### Requirement: Games API endpoint
The system SHALL provide `GET /api/games` returning paginated, filtered, sorted game data. The endpoint MUST require admin or owner role authentication.

Query parameters:
- `page` (integer, default 1)
- `pageSize` (integer, default 50)
- `search` (string, free-text across: host, guest, hostConnectionId, guestConnectionId, hostEncryptId, guestEncryptId, seed, deck, jokers, vouchers)
- `sortBy` (string: host, guest, deck, stake, durationSeconds, startDate, moneySpent, rerolls)
- `sortOrder` (string: asc, desc)
- `deck` (string, exact match filter)
- `stake` (integer, exact match filter)
- `winner` (string: logOwner, opponent — exact match filter)
- `ruleset` (string, exact match filter)

Response shape:
```json
{
  "data": [Game],
  "page": number,
  "pageSize": number,
  "total": number,
  "totalPages": number
}
```

#### Scenario: Paginated fetch with no filters
- **WHEN** `GET /api/games?page=1&pageSize=50`
- **THEN** returns first 50 games sorted by startDate desc with total count

#### Scenario: Free-text search
- **WHEN** `GET /api/games?search=Blueprint`
- **THEN** returns games where any searchable field contains "Blueprint" (case-insensitive)

#### Scenario: Combined filters
- **WHEN** `GET /api/games?deck=Red+Deck&stake=4&winner=logOwner&sortBy=durationSeconds&sortOrder=desc`
- **THEN** returns only games matching all filters, sorted by duration descending

#### Scenario: Unauthenticated request
- **WHEN** request has no valid admin/owner session
- **THEN** returns 401

### Requirement: Admin games page
The system SHALL provide an admin page at `/admin/games` accessible to users with `admin` or `owner` role.

The page MUST include:
- Search input (debounced, 400ms) for free-text search
- Dropdown filters for: deck, stake, winner, ruleset
- Sortable table columns: host, guest, deck, stake, duration, start date, money spent, rerolls
- Pagination controls (matching existing PaginationControls component)
- All filter/sort/page state persisted in URL query params via `nuqs`

#### Scenario: Page loads with defaults
- **WHEN** admin navigates to `/admin/games`
- **THEN** page shows first 50 games sorted by startDate desc, no filters applied

#### Scenario: Search updates URL and results
- **WHEN** admin types "PlayerName" in search input
- **THEN** after 400ms debounce, URL updates with `?search=PlayerName` and table shows filtered results

#### Scenario: Filter by stake
- **WHEN** admin selects stake 8 from dropdown
- **THEN** URL updates with `?stake=8`, table shows only Gold Stake games, page resets to 1

### Requirement: Games table columns
The table MUST display the following columns:
- Host (player name)
- Guest (player name)
- Winner (resolved to actual player name, not "logOwner"/"opponent")
- Deck
- Seed
- Stake (with stake name, e.g. "Gold Stake")
- Ruleset
- Duration (formatted as Xh Xm Xs)
- Start Date (formatted)
- Host Connection ID
- Guest Connection ID
- Host Encrypt ID
- Guest Encrypt ID
- Owner Jokers (comma-separated or badges)
- Opponent Jokers
- Owner Vouchers
- Opponent Vouchers
- Money Spent
- Rerolls
- Actions (link to log parser)

#### Scenario: Winner column shows actual name
- **WHEN** game has `winner: "logOwner"`, `isHost: true`, `host: "Alice"`
- **THEN** winner column displays "Alice"

#### Scenario: Actions link to log parser
- **WHEN** admin clicks the log parser link for a game with `logFileId: 123`, `gameIndex: 2`
- **THEN** navigates to `/log-parser?logId=123&game=2`
