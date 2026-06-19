## Purpose

Define season configuration storage, lookup, and validation rules.

## Requirements

### Requirement: Seasons stored in database
Season configuration (id, name, start date, end date, active flag) SHALL be stored in a `seasons` DB table and served from there at runtime. No season dates or identifiers SHALL be hardcoded.

#### Scenario: Load season list
- **WHEN** any component or service requests the list of seasons
- **THEN** the system returns all rows from the `seasons` table ordered by id ascending

#### Scenario: Seed existing seasons
- **WHEN** the migration runs on a fresh or existing database
- **THEN** seasons 1–6 are present in the `seasons` table with their correct start dates, season 6 has `isActive = true`, and all others have `isActive = false`

### Requirement: Season identified from date
The system SHALL determine which season a game timestamp belongs to by querying the `seasons` table, not hardcoded date constants.

#### Scenario: Date falls within a season range
- **WHEN** `getSeasonForDate(date)` is called with a timestamp between a season's `startDate` and `endDate`
- **THEN** the function returns the `season{N}` string for that season

#### Scenario: Date is in the active season
- **WHEN** `getSeasonForDate(date)` is called with a timestamp after the active season's `startDate` and `endDate` is null
- **THEN** the function returns the `season{N}` string for the active season

### Requirement: Season config cached to avoid per-request DB hits
Season configuration SHALL be cached in Redis under `config:seasons`. On cache miss, the system SHALL read from DB and repopulate Redis. The cache SHALL be invalidated or refreshed when a season is created or updated via the admin UI.

#### Scenario: Cache refreshed after season update
- **WHEN** an owner creates or updates a season via the admin API
- **THEN** the Redis key `config:seasons` is deleted or rewritten so the next read returns fresh season config

### Requirement: SeasonSchema accepts dynamic season strings
The `SeasonSchema` Zod validator SHALL accept any string matching `/^season\d+$/` rather than a fixed enum. Input that does not match SHALL be rejected with a validation error.

#### Scenario: Valid season string accepted
- **WHEN** the API receives `season7` as a season parameter
- **THEN** validation passes

#### Scenario: Invalid season string rejected
- **WHEN** the API receives `week1` or `7` as a season parameter
- **THEN** validation fails with an appropriate error message
