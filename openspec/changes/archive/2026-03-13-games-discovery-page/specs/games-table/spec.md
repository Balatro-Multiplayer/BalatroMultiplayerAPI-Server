## ADDED Requirements

### Requirement: Games table schema
The system SHALL have a `games` table with the following columns:
- `id` (serial, primary key)
- `logFileId` (integer, foreign key to `logFiles.id`, indexed)
- `gameIndex` (integer, 0-based position in parsedJson array)
- `host` (text, indexed)
- `guest` (text, indexed)
- `logOwnerName` (text)
- `opponentName` (text)
- `isHost` (boolean)
- `hostConnectionId` (text, indexed)
- `guestConnectionId` (text, indexed)
- `hostEncryptId` (text, indexed)
- `guestEncryptId` (text, indexed)
- `deck` (text, indexed)
- `seed` (text, indexed)
- `stake` (integer)
- `ruleset` (text)
- `options` (json)
- `winner` (text, nullable)
- `startDate` (timestamp, indexed)
- `endDate` (timestamp)
- `durationSeconds` (integer)
- `moneyGained` (integer)
- `moneySpent` (integer)
- `opponentMoneySpent` (integer)
- `rerolls` (integer)
- `rerollCostTotal` (integer)
- `opponentRerolls` (integer)
- `opponentRerollCostTotal` (integer)
- `logOwnerFinalJokers` (json)
- `opponentFinalJokers` (json)
- `logOwnerVouchers` (json)
- `opponentVouchers` (json)
- `createdAt` (timestamp)

A unique constraint SHALL exist on `(logFileId, gameIndex)`.

#### Scenario: Table created via migration
- **WHEN** drizzle migration runs
- **THEN** the `games` table exists with all columns and indexes

### Requirement: Extract connection and encrypt IDs from mods
The system SHALL extract `hostConnectionId`, `guestConnectionId`, `hostEncryptId`, `guestEncryptId` from `hostMods` and `guestMods` arrays using regex patterns:
- `serversideConnectionID=(.+)` → connectionId
- `encryptID=(.+)` → encryptId

#### Scenario: Mods contain both IDs
- **WHEN** hostMods contains `["serversideConnectionID=42f1031c", "encryptID=65040293270.659"]`
- **THEN** `hostConnectionId` = `"42f1031c"` and `hostEncryptId` = `"65040293270.659"`

#### Scenario: Mods missing IDs
- **WHEN** hostMods does not contain a connectionID or encryptID entry
- **THEN** the corresponding column is `null`

### Requirement: Backfill script
The system SHALL provide a script at `scripts/backfill-games.ts` that:
- Reads all `logFiles` rows
- Extracts games from `parsedJson`
- Inserts into `games` table with conflict handling on `(logFileId, gameIndex)`
- Uses batch inserts for performance
- Logs progress
- Calls `process.exit()` on completion

#### Scenario: Backfill existing data
- **WHEN** script runs against a database with 42k+ log files
- **THEN** all games are inserted into the `games` table without duplicates

#### Scenario: Re-running backfill
- **WHEN** script runs again after a previous backfill
- **THEN** existing rows are skipped (upsert/conflict handling), no duplicates created

### Requirement: Insert games on upload
The system SHALL insert games into the `games` table when `PUT /api/logs/upload` saves `parsedJson`. This MUST happen in the same transaction as the existing logFile update.

#### Scenario: New log file uploaded with 3 games
- **WHEN** a log file is uploaded and parsed into 3 games
- **THEN** 3 rows are inserted into `games` with `gameIndex` 0, 1, 2

#### Scenario: Log file re-uploaded (parsedJson updated)
- **WHEN** parsedJson is updated for an existing logFile
- **THEN** old game rows for that logFileId are deleted and new ones inserted
