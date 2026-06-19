## Context

The Botlatro-Multiplayer Discord bot manages player moderation (strikes/bans) via slash commands, storing data in its own Postgres DB. The balatro-mp website is a separate Next.js app with its own DB, connecting to the bot via a Hono API at `http://balatro.virtualized.dev:4931/`. The bot API uses `@hono/zod-openapi` with bearer auth on protected routes. The website wraps bot API calls in `botlatro.service.ts` and exposes them via tRPC routers.

Existing moderation flow:
- `/strike give` — adds strike to DB, logs embed to Discord channel, DMs user
- `/strike remove` — deletes strike from DB, logs removal embed
- `/ban add` — inserts ban with expiry, logs embed
- `/ban remove` — deletes ban row, logs embed
- `/ban list` — lists all banned users

Strike tiers: 0 (warning), 1 (no punishment), 2 (1d QTO), 3 (3d QTO), 4 (7d QTO + temp tourney ban), 5 (month QTO + temp tourney ban), 6 (perma blacklist).

## Goals / Non-Goals

**Goals:**
- Full parity with bot slash commands for strike/ban management
- Searchable, card-based, mobile-friendly admin UI
- Role-gated access: helper+ for strikes, admin+ for bans
- Discord channel logging on all mutations (handled bot-side)
- Minimal Discord API usage via guild member search through bot

**Non-Goals:**
- Replacing the Discord bot commands (both interfaces coexist)
- Per-queue ban management (bot doesn't support it yet either)
- Real-time sync/websockets between bot and website
- Editing existing strikes (bot doesn't support this)
- DM notifications from web actions (bot commands already handle this; web mutations log to Discord only)

## Decisions

### 1. Bot API as the single interface for all mutations

All strike/ban CRUD goes through bot API endpoints. The bot handles DB writes + Discord logging in the same request. Website never touches the bot's database directly.

**Why over direct DB access:** Bot already has the logging logic, Discord client, and expiry calculation. Duplicating that on the website side would create drift. Single API keeps behavior consistent whether action comes from Discord or web.

### 2. Guild member search via bot for user typeahead

The bot calls `guild.members.fetch({ query, limit: 10 })` — a single Discord API call that supports prefix search on guild members. Results returned to website, cached in Redis (existing `discord.service.ts` pattern, 24h TTL).

**Why over Discord API from website:** The bot already has a Discord client and guild access. The website's `discord.service.ts` can only look up users by exact ID, not search by name.

**Why over pre-syncing all members:** Bot lacks `GuildMembers` intent (no bulk member cache). Adding it would require privileged intent approval and increase memory usage. On-demand search is sufficient.

### 3. Card-based UI with player grouping

Default view shows players grouped by user, each as a collapsible card showing their strikes and ban status. No tables.

**Why:** Tables are poor for this data — each player has a variable number of strikes, reasons are long text, and mobile tables are painful. Cards naturally accommodate variable-height content and collapse well on mobile.

### 4. Tabs for quick filtering: Active Bans / Recent Strikes / All

Three views sharing the same search bar. "Active Bans" shows currently banned players. "Recent Strikes" shows latest strike activity. "All" shows all players with any moderation history.

### 5. Bot API returns resolved Discord user info alongside moderation data

Strike/ban list endpoints return `{ discord_id, username, display_name, avatar_url }` for each user. Bot resolves this from its own `client.users.fetch()` cache. Avoids N+1 Discord API calls from the website side.

### 6. Pagination over infinite scroll

Paginated results with page controls. Consistent with existing admin pages (roles, logs, etc).

## Risks / Trade-offs

- **Bot API availability** → If bot is down, moderation panel is non-functional. Acceptable since bot downtime also means no matches.
- **Guild member search rate limits** → Discord's guild member search has generous limits (~10/10s). Debounced typeahead (300ms) keeps this well under limits. Redis caching prevents duplicate searches.
- **Stale user info** → Bot's `client.users.fetch()` cache may have stale usernames/avatars. 24h Redis TTL on website side compounds this. Acceptable for admin tooling.
- **Strike removal is a hard delete** → Bot currently DELETEs strike rows. This means removed strikes are gone. The existing bot TODO mentions adding an `active` flag instead — out of scope for this change but worth noting.
- **Ban removal is a hard delete** → Same as strikes. Bot has a TODO to add an `active` flag.
