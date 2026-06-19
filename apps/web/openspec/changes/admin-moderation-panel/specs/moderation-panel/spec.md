## ADDED Requirements

### Requirement: Admin moderation page accessible to helpers and admins
The website SHALL have a page at `/admin/moderation` accessible only to users with role `helper` or higher. The page SHALL appear in the admin navigation menu.

#### Scenario: Helper accesses moderation page
- **WHEN** a user with role `helper` navigates to `/admin/moderation`
- **THEN** they see the moderation panel with strike management capabilities

#### Scenario: Regular user denied access
- **WHEN** a user with role `user` navigates to `/admin/moderation`
- **THEN** they are denied access (redirect or error)

### Requirement: Role-gated actions
Strike actions (give/remove) SHALL be available to users with role `helper` or higher. Ban actions (add/remove) SHALL be available only to users with role `admin` or higher. Ban information SHALL be visible to helpers but action buttons SHALL be hidden.

#### Scenario: Helper sees ban info but cannot act
- **WHEN** a helper views a player card for a banned user
- **THEN** they see the ban details (reason, expiry) but no "Lift Ban" or "Ban User" buttons

#### Scenario: Admin sees ban actions
- **WHEN** an admin views a player card for a banned user
- **THEN** they see ban details and the "Lift Ban" button

### Requirement: Card-based player view
The moderation panel SHALL display players as collapsible cards, not tables. Each card SHALL show the player's Discord avatar, username, total strike points, and ban status summary. Expanding a card SHALL reveal individual strike entries and ban details.

#### Scenario: Collapsed player card
- **WHEN** the moderation page loads
- **THEN** each player is shown as a card with avatar, username, total strike points, and ban status badge

#### Scenario: Expanded player card
- **WHEN** a user expands a player card
- **THEN** individual strikes are shown with ID, amount, reason, reference, issuer, and date, plus ban details if applicable

### Requirement: Tab-based filtering
The moderation panel SHALL have three tabs: "Active Bans", "Recent Strikes", and "All". "Active Bans" SHALL show only currently banned players. "Recent Strikes" SHALL show players with recent strike activity sorted by most recent. "All" SHALL show all players with any moderation history.

#### Scenario: Active Bans tab
- **WHEN** user selects "Active Bans" tab
- **THEN** only players with an active (non-expired) ban are shown

#### Scenario: Recent Strikes tab
- **WHEN** user selects "Recent Strikes" tab
- **THEN** players are shown sorted by their most recent strike date, descending

### Requirement: Search functionality
The moderation panel SHALL have a search input that filters players by username or Discord ID. Search SHALL work across all tabs. Search SHALL be debounced (300ms).

#### Scenario: Search by username
- **WHEN** user types "play" in the search bar
- **THEN** only players whose username contains "play" are shown

#### Scenario: Search by Discord ID
- **WHEN** user types a Discord snowflake ID in the search bar
- **THEN** the matching player is shown if they have moderation history

### Requirement: Give strike dialog
The moderation panel SHALL have a "Give Strike" action that opens a dialog/sheet with fields: player (typeahead search), amount (select with tier labels), reason (text), and reference (text). Submitting SHALL call the bot API and optimistically update the UI.

#### Scenario: Give strike with typeahead
- **WHEN** admin clicks "Give Strike" and types a username in the player field
- **THEN** a dropdown shows matching guild members from the bot's search endpoint

#### Scenario: Submit strike
- **WHEN** admin fills out the form and clicks confirm
- **THEN** strike is created via API, card updates optimistically, and a success toast is shown

#### Scenario: Strike creation fails
- **WHEN** the API call fails
- **THEN** optimistic update is rolled back and an error toast is shown

### Requirement: Remove strike action
Each strike entry in a player card SHALL have a "Remove" button. Clicking it SHALL show a confirmation with an optional reason field. Confirming SHALL call the bot API and optimistically update the UI.

#### Scenario: Remove strike with reason
- **WHEN** admin clicks "Remove" on a strike, enters a reason, and confirms
- **THEN** strike is removed via API with the reason, card updates, success toast shown

#### Scenario: Remove strike without reason
- **WHEN** admin clicks "Remove" on a strike and confirms without entering a reason
- **THEN** strike is removed via API without a reason, card updates, success toast shown

### Requirement: Ban user dialog
The moderation panel SHALL have a "Ban User" action (admin+ only) that opens a dialog/sheet with fields: player (typeahead search), length in days (number input), and reason (text). Submitting SHALL call the bot API and optimistically update the UI.

#### Scenario: Ban user
- **WHEN** admin fills out the ban form and confirms
- **THEN** ban is created via API, player card updates to show ban status, success toast shown

### Requirement: Lift ban action
Each active ban in a player card SHALL have a "Lift Ban" button (admin+ only). Clicking it SHALL show a confirmation with an optional reason field. Confirming SHALL call the bot API and optimistically update the UI.

#### Scenario: Lift ban with reason
- **WHEN** admin clicks "Lift Ban", enters a reason, and confirms
- **THEN** ban is removed via API with the reason, card updates, success toast shown

### Requirement: Pagination
The moderation panel SHALL paginate results with page controls. Pagination controls SHALL show current page, total pages, and total items count.

#### Scenario: Navigate pages
- **WHEN** user clicks "Next" on page 1 of 3
- **THEN** page 2 results are loaded and pagination updates

### Requirement: Mobile-friendly layout
The moderation panel SHALL be fully usable on mobile. Cards SHALL be full-width on small screens. Action buttons ("Give Strike", "Ban User") SHALL appear as a sticky FAB or bottom bar on mobile. Dialogs SHALL render as bottom sheets on mobile.

#### Scenario: Mobile card layout
- **WHEN** user views the page on a mobile device
- **THEN** player cards stack full-width and strikes are collapsed by default

#### Scenario: Mobile action buttons
- **WHEN** user views the page on a mobile device
- **THEN** "Give Strike" and "Ban User" buttons are accessible via a sticky element at the bottom

### Requirement: tRPC router with role checks
A new tRPC router SHALL wrap the bot API calls with role-based middleware. Strike procedures SHALL require `helper` role or higher. Ban procedures SHALL require `admin` role or higher.

#### Scenario: Helper calls strike procedure
- **WHEN** a helper calls a strike tRPC procedure
- **THEN** the call succeeds and reaches the bot API

#### Scenario: Helper calls ban procedure
- **WHEN** a helper calls a ban tRPC procedure
- **THEN** the call is rejected with an authorization error

### Requirement: Bot service layer
`botlatro.service.ts` SHALL have methods for all moderation API endpoints: `listPlayersWithStrikes`, `getUserStrikes`, `giveStrike`, `removeStrike`, `listActiveBans`, `banUser`, `unbanUser`, `searchGuildMembers`. All methods SHALL use bearer auth and handle errors.

#### Scenario: Service call with auth
- **WHEN** a service method is called
- **THEN** it sends a request to the bot API with the `Authorization: Bearer` header
