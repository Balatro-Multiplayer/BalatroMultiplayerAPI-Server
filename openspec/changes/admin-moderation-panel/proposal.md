## Why

Helpers and admins currently manage strikes and bans exclusively through Discord bot slash commands. This is clunky for bulk review, hard to search, and impossible to use on mobile. A web admin panel provides a searchable, mobile-friendly interface for all moderation actions while keeping the bot as the source of truth.

## What Changes

- New admin page at `/admin/moderation` with card-based, search-first UI for managing strikes and bans
- New bot API endpoints (`/api/moderation/*`) for CRUD on strikes/bans + guild member search, with built-in Discord channel logging on mutations
- Website calls bot API through `botlatro.service.ts`, exposed via tRPC with role-based access (helper+ for strikes, admin+ for bans)
- Guild member search via bot API (`guild.members.fetch({ query })`) with results cached in Redis on the website side
- Discord user info (username, avatar) resolved via bot's `client.users.fetch()` and returned alongside strike/ban data

## Capabilities

### New Capabilities
- `moderation-api`: Bot-side Hono API endpoints for strikes/bans CRUD, guild member search, and Discord logging
- `moderation-panel`: Website admin page with card-based UI for viewing, searching, giving, and removing strikes and bans

### Modified Capabilities

## Impact

- **Bot repo** (`~/dev/Botlatro-Multiplayer`): New `moderation.router.ts` registered in `app.ts`, new command handlers for moderation CRUD, reuses existing `logStrike`/`createEmbedType` for Discord logging
- **Website repo** (`~/dev/balatro-mp`): New service methods in `botlatro.service.ts`, new tRPC router `moderation.ts`, new admin page + components at `src/app/(home)/admin/moderation/`
- **Redis**: Caching guild member search results and Discord user lookups (existing `discord.service.ts` pattern)
- **Auth**: Leverages existing site role system (`helper`, `admin` roles on `users` table)
