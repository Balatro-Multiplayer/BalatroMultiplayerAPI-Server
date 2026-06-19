## ADDED Requirements

### Requirement: Game query parameter support
The log parser page SHALL accept an optional `game` query parameter (integer, 0-based index) that selects the corresponding game tab on load.

#### Scenario: Deep link with game param
- **WHEN** user navigates to `/log-parser?logId=123&game=2`
- **THEN** log parser loads log file 123 and auto-selects the 3rd game tab (index 2)

#### Scenario: No game param
- **WHEN** user navigates to `/log-parser?logId=123` (no game param)
- **THEN** log parser behaves as before, defaulting to the first game tab

#### Scenario: Invalid game index
- **WHEN** `game` param exceeds the number of parsed games
- **THEN** log parser defaults to the first game tab

### Requirement: Controlled tab state
The `Tabs` component MUST be controlled via `value` + `onValueChange`, with initial value derived from the `game` query param when present.

#### Scenario: Tab value syncs with game param
- **WHEN** log parser loads with `game=1` and there are 3 games
- **THEN** the tab value is set to the value corresponding to game index 1 (the 2nd game)

#### Scenario: User switches tabs manually
- **WHEN** user clicks a different game tab after deep linking
- **THEN** the active tab updates normally
