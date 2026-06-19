## ADDED Requirements

### Requirement: List players with strikes
The bot API SHALL expose `GET /api/moderation/strikes` (auth-protected) returning all players who have strikes, grouped by user. Each entry SHALL include the user's Discord info (`discord_id`, `username`, `display_name`, `avatar_url`), their strikes array, and active ban status if any. Results SHALL be paginated. An optional `search` query param SHALL filter by username substring.

#### Scenario: List all players with strikes
- **WHEN** authenticated client sends `GET /api/moderation/strikes?page=1&limit=20`
- **THEN** API returns paginated list of players with strikes, each including resolved Discord user info, strikes array sorted by `issued_at` desc, and ban status

#### Scenario: Search players with strikes
- **WHEN** authenticated client sends `GET /api/moderation/strikes?search=username`
- **THEN** API returns only players whose username matches the search substring

### Requirement: Get strikes for a specific user
The bot API SHALL expose `GET /api/moderation/strikes/:user_id` (auth-protected) returning all strikes for a specific Discord user, along with their Discord info and active ban status.

#### Scenario: Get user strikes
- **WHEN** authenticated client sends `GET /api/moderation/strikes/123456789`
- **THEN** API returns the user's Discord info, all strikes sorted by `issued_at` desc, and active ban if any

#### Scenario: User has no strikes
- **WHEN** authenticated client sends `GET /api/moderation/strikes/999` for a user with no strikes
- **THEN** API returns the user's Discord info with an empty strikes array

### Requirement: Give a strike
The bot API SHALL expose `POST /api/moderation/strikes` (auth-protected) accepting `user_id`, `amount` (0-6), `reason` (optional, defaults to "No reason provided"), `reference` (optional), and `issued_by_id`. The endpoint SHALL insert the strike, calculate expiry using existing `calculateExpiryDate` logic, log an embed to the Discord strike log channel, and return the created strike.

#### Scenario: Give a strike with all fields
- **WHEN** authenticated client sends `POST /api/moderation/strikes` with `{ user_id, amount: 2, reason: "AFK", reference: "queue-1", issued_by_id }`
- **THEN** API inserts strike with calculated expiry, logs embed to Discord channel, and returns the created strike with its ID

#### Scenario: Give a warning (amount 0) to user with no prior strikes
- **WHEN** authenticated client sends `POST /api/moderation/strikes` with `amount: 0` for a user with no prior strikes
- **THEN** API inserts strike with amount 0 (not upgraded to 1)

#### Scenario: Give a warning (amount 0) to user with prior strikes
- **WHEN** authenticated client sends `POST /api/moderation/strikes` with `amount: 0` for a user who already has strikes
- **THEN** API inserts strike with amount upgraded to 1 (matching existing bot behavior)

### Requirement: Remove a strike
The bot API SHALL expose `DELETE /api/moderation/strikes/:id` (auth-protected) accepting an optional `reason` in the request body and `removed_by_id`. The endpoint SHALL delete the strike, log a removal embed to the Discord strike log channel, and return success.

#### Scenario: Remove existing strike
- **WHEN** authenticated client sends `DELETE /api/moderation/strikes/42` with `{ removed_by_id, reason: "Mistake" }`
- **THEN** API deletes the strike, logs removal embed with reason to Discord, and returns success

#### Scenario: Remove strike without reason
- **WHEN** authenticated client sends `DELETE /api/moderation/strikes/42` with `{ removed_by_id }` and no reason
- **THEN** API deletes the strike, logs removal embed without reason field, and returns success

#### Scenario: Remove non-existent strike
- **WHEN** authenticated client sends `DELETE /api/moderation/strikes/999`
- **THEN** API returns 404

### Requirement: List active bans
The bot API SHALL expose `GET /api/moderation/bans` (auth-protected) returning all currently active bans with resolved Discord user info. Results SHALL be paginated. An optional `search` query param SHALL filter by username.

#### Scenario: List active bans
- **WHEN** authenticated client sends `GET /api/moderation/bans?page=1&limit=20`
- **THEN** API returns paginated list of active bans with Discord user info, sorted by `expires_at` asc

### Requirement: Ban a user
The bot API SHALL expose `POST /api/moderation/bans` (auth-protected) accepting `user_id`, `length` (days), `reason` (optional), and `banned_by_id`. The endpoint SHALL insert the ban, log an embed to the Discord log channel, and return the created ban.

#### Scenario: Ban a user
- **WHEN** authenticated client sends `POST /api/moderation/bans` with `{ user_id, length: 7, reason: "Repeated offenses", banned_by_id }`
- **THEN** API inserts ban with `expires_at` = now + 7 days, logs embed to Discord, and returns the created ban

### Requirement: Unban a user
The bot API SHALL expose `DELETE /api/moderation/bans/:user_id` (auth-protected) accepting optional `reason` and `unbanned_by_id` in the request body. The endpoint SHALL delete the ban, log an embed to Discord, and return success.

#### Scenario: Unban a user
- **WHEN** authenticated client sends `DELETE /api/moderation/bans/123456789` with `{ unbanned_by_id, reason: "Appeal accepted" }`
- **THEN** API deletes the ban, logs unban embed to Discord, and returns success

#### Scenario: Unban user with no active ban
- **WHEN** authenticated client sends `DELETE /api/moderation/bans/999` for a user with no ban
- **THEN** API returns 404

### Requirement: Search guild members
The bot API SHALL expose `GET /api/moderation/users/search?q=...` (auth-protected) returning matching guild members using Discord's `guild.members.fetch({ query, limit: 10 })`. Each result SHALL include `discord_id`, `username`, `display_name`, and `avatar_url`.

#### Scenario: Search guild members
- **WHEN** authenticated client sends `GET /api/moderation/users/search?q=play`
- **THEN** API returns up to 10 guild members whose username/display name starts with "play", each with full user info

#### Scenario: Empty search query
- **WHEN** authenticated client sends `GET /api/moderation/users/search?q=`
- **THEN** API returns 400 bad request
