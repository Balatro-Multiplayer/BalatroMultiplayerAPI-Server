## ADDED Requirements

### Requirement: Season list page accessible to owners only
The `/admin/seasons` page SHALL be accessible only to users with the `owner` role. All other roles SHALL be redirected to `/`.

#### Scenario: Owner accesses page
- **WHEN** a user with `owner` role navigates to `/admin/seasons`
- **THEN** the page renders a table of all seasons

#### Scenario: Non-owner access blocked
- **WHEN** a user without `owner` role navigates to `/admin/seasons`
- **THEN** the user is redirected to `/`

---

### Requirement: Season list displays all seasons with status
The seasons table SHALL show: season id, name, start date, end date (or "Active"), active badge, snapshot count, and action buttons.

#### Scenario: Active season displayed
- **WHEN** a season has `isActive = true` and no `endDate`
- **THEN** the end date column shows "Active" and an active badge is visible

#### Scenario: Past season displayed
- **WHEN** a season has an `endDate`
- **THEN** start and end dates are shown in a human-readable format

---

### Requirement: Owner can create a new season
The admin UI SHALL provide a form to create a new season with name and start date fields. On submission the season is saved to DB and the seasons cache is invalidated.

#### Scenario: Successful season creation
- **WHEN** an owner submits the new season form with a valid name and start date
- **THEN** a new row is inserted in the `seasons` table, the Redis key `config:seasons` is invalidated or refreshed, and the list refreshes

#### Scenario: Missing required fields rejected
- **WHEN** the form is submitted without a name or start date
- **THEN** validation errors are shown and no DB write occurs

---

### Requirement: Owner can edit a season
The season detail page SHALL allow editing the name, start date, end date, and active flag. Only one season SHALL have `isActive = true` at a time.

#### Scenario: Setting a season as active deactivates others
- **WHEN** an owner sets season N as active
- **THEN** all other seasons have `isActive` set to false, and season N has `isActive = true`

#### Scenario: End date saved
- **WHEN** an owner sets an end date for a season
- **THEN** the `endDate` is persisted and the season no longer appears as "Active"

---

### Requirement: Owner can manage per-queue snapshots for a season
The season detail page SHALL show a snapshot management table with one row per known queue type (ranked, smallworld, vanilla, legacy). Each row shows upload status, MinIO key, upload date, and action buttons.

#### Scenario: No snapshot for a queue
- **WHEN** no `season_snapshots` record exists for a (season, queue)
- **THEN** the row shows "Not uploaded" and an upload button

#### Scenario: Snapshot exists for a queue
- **WHEN** a `season_snapshots` record exists
- **THEN** the row shows upload date, a truncated MinIO key, Invalidate Cache, and Delete buttons

---

### Requirement: Owner can upload a leaderboard snapshot JSON file
The upload control SHALL accept a `.json` file, validate it client-side as parseable JSON, upload it to MinIO via a tRPC mutation, and create or replace the `season_snapshots` record.

#### Scenario: Valid JSON uploaded
- **WHEN** an owner selects a valid JSON file and submits
- **THEN** the file is uploaded to MinIO, the DB record is created or replaced, and the Redis cache key for that (season, queue) is deleted

#### Scenario: Invalid file rejected
- **WHEN** an owner selects a non-JSON or malformed file
- **THEN** an error is shown before any upload attempt

---

### Requirement: Owner can invalidate Redis cache for a (season, queue)
A button on each snapshot row SHALL trigger deletion of the corresponding Redis key `leaderboard:s{N}:{queueId}`.

#### Scenario: Cache invalidated
- **WHEN** owner clicks "Invalidate Cache"
- **THEN** the Redis key is deleted, a success toast is shown, and the button briefly shows a confirmation state

---

### Requirement: Owner can delete a snapshot
Deleting a snapshot SHALL remove the MinIO object, the `season_snapshots` DB record, and the Redis cache key.

#### Scenario: Snapshot deleted
- **WHEN** owner clicks delete and confirms
- **THEN** MinIO object is removed, DB record is deleted, Redis key is deleted, and the row reverts to "Not uploaded"
