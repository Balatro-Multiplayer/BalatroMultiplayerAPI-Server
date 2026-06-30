# BalatroMultiplayerAPI-Server

The backend for Balatro Multiplayer: a TypeScript + Express server backed by
PostgreSQL (via Drizzle ORM) and an EMQX MQTT broker. It handles authentication
(Steam ticket, Discord OAuth), lobbies, ranked matchmaking
with Elo, per-season leaderboards, text chat, and the web admin panel.

The server code lives in [apps/server](apps/server). Everything below runs from
that directory.

## How to set up a Dev Server

### Enviroment

Copy [.env.example](apps/server/.env.example) to `.env` and fill it in.

Required:

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Signs auth JWTs |
| `EMQX_SYSTEM_PASSWORD` | MQTT system-user password |
| `PLAYER_ID_SALT` | Salt for hashing Steam/Discord IDs (≥32 chars) |
| `ADMIN_SECRET` | Guards `POST /admin` endpoints (≥32 chars) |

There are more secrets in .env.example but some default to values you probably want to keep, like the locations of the emqx broker and database, and some you don't need like Steam and Discord. If you want to test a real authentication flow you will need to provide a Steam Web API key.

Flags:

| Variable | Purpose |
|----------|---------|
| `CHAT_ENABLED` | Disable or enable text chat from a server level |
| `TESTING_MODE` | Require accounts to have a `tester` privilige to queue or create a lobby |

### Running

The [docker-compose.yml](docker-compose.yml) at the repo root brings up the whole
stack on one network. The API container runs migrations automatically on start.

From the `BalatroMultiplayerAPI-Server` directory:

```sh
docker compose up -d --build      # build + start everything in the background
docker compose logs -f api        # follow the API server logs
docker compose down               # stop (add -v to also wipe the db/broker volumes)
```

### Seeding test data

The seed script lives in
[src/infrastructure/db/](apps/server/src/infrastructure/db). It is idempotent
(`onConflictDoNothing`), so re-runs won't overwrite existing rows. A player only
appears on a leaderboard after its board is recomputed.

[seed-speedrun-players.ts](apps/server/src/infrastructure/db/seed-speedrun-players.ts)
creates 200 accounts named `Player001`..`Player200`, each with a varied rating
and best time on both speedrunning ranked boards
(`ranked:spdrn_gold_stake_single` and `ranked:spdrn_white_stake_triple`), then
recomputes the leaderboard cache. It is non-destructive: it uses the active
season (creating `Season 0` only if none exists) and leaves other accounts alone.

Against the Docker stack:

```sh
docker compose exec api pnpm --filter balatro-multiplayer-api-server exec \
  tsx src/infrastructure/db/seed-speedrun-players.ts
```

Or directly against a local Postgres, from `apps/server`:

```sh
tsx --env-file=.env src/infrastructure/db/seed-speedrun-players.ts
```

## Launching multiple clients (dev impersonation)

In `NODE_ENV=development` the server exposes a dev-only impersonation auth
endpoint (404 in production) that logs a game client in as an existing player
without a real Steam ticket. The mod's dev overrides in
[BalatroMultiplayerAPI/dev/init.lua](../BalatroMultiplayerAPI/dev/init.lua) wire
this to two environment variables read at launch, set one before starting a game
instance and that instance authenticates as the chosen account:

- `BMP_IMPERSONATE_NAME=<steamName>` - e.g. a seeded `Player001`
- `BMP_IMPERSONATE_ID=<players.id uuid>` - exact player id (takes precedence)

To exercise a two-player match locally:

1. **Start the stack** (`docker compose up -d --build`, or `npm run dev` from
   `apps/server` with Postgres + EMQX already up).
2. **Seed accounts** so there are real players to impersonate:
   ```sh
   tsx --env-file=.env src/infrastructure/db/seed-speedrun-players.ts
   ```
3. **Launch one game instance per client**, each with a different impersonation
   variable set:
   ```sh
   BMP_IMPERSONATE_NAME=Player001 balatro     # host
   BMP_IMPERSONATE_NAME=Player002 balatro     # guest, separate instance
   ```
   The host creates a lobby; each guest joins by its code. Leave a variable unset
   on any instance you want to authenticate with real Steam instead.