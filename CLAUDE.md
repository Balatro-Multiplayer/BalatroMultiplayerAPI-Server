# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## What this project is

**BalatroMultiplayerAPI-Server** — backend for *Balatro Multiplayer* (BMP), a mod that adds online multiplayer to the game Balatro. TypeScript + Express server, PostgreSQL via Drizzle ORM, EMQX MQTT broker for realtime transport. Handles auth (Steam ticket, Discord OAuth), lobbies, ranked matchmaking (Elo), per-season leaderboards, text chat, replay/anti-cheat logging, and a web admin panel.

pnpm/Turborepo monorepo. **Branch note:** `main` is a stale legacy branch still on the old Lua/Lobby.lua + plain-WebSocket architecture (`Server/src/*.js`). Active development happens on other branches (e.g. `mqtt`), which are hundreds of commits ahead and contain the actual modern rewrite (this TS/Express/EMQX/Next.js stack, matchmaking, moderation, etc.). Diffing against `main` is *not* a meaningful way to isolate recent work — use `git log --oneline` on the active branch itself instead.

## Repo layout

```
apps/
  server/     — Express/TypeScript API server (core of the repo)
  web/        — Next.js 16 site: marketing, docs (Fumadocs/MDX), web admin frontend
packages/
  internal/   — @v-rtualized/bmp-internal public stub; real impl is a private package
                injected at deploy time (e.g. launcher-integrity ChallengeStrategy).
                Its absence = "feature disabled", not an error.
  types/      — @bmp/types, shared across server/web/internal
docker-compose.yml  — emqx + postgres + api + web, one "bmp" network
turbo.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json
```

### `apps/server/src/`
```
main.ts             — process entry: build Express app, connect DB/MQTT, provision EMQX
                       webhook, restore matches from DB, start cron-like jobs
                       (matchmaking, session cleanup, hourly purges), sync mod registry,
                       app.listen(); handles SIGTERM/SIGINT graceful shutdown
env.ts               — typed env loading/validation
routes/index.ts      — mounts every feature router
features/            — feature-sliced: admin, auth, chat, emqx, launcher-integrity,
                       lobby, matchmaking, mods, mutes, releases, replay-log, reports,
                       stats, webadmin  (each: *.route.ts + *.service.ts + tests)
infrastructure/
  db/                — Drizzle schema.ts (~24 tables), migrate.ts, connection pool
  emqx/              — EMQX admin/provisioning (rule/webhook auto-setup via mgmt API)
  mqtt/              — mqtt.service.ts (broker client), grace-period.service.ts,
                       spectator-registry.ts
  gateways/          — per-domain data-access (ban, chat, matchmaking, replay-log, etc.)
middleware/          — authenticate, errorHandler
state/               — in-memory live game state (lobbies, sessions, matches, queues)
shared/, contracts/, tests/ (unit + e2e flow1..flow5)
```

Also: `drizzle/*.sql` migrations, `emqx/cluster.hocon` (EMQX static config), `.env.example`, `Dockerfile`, `docker-compose.e2e.yml`.

`apps/web/src/` (Next.js App Router): `app/` (home, api, auth, docs, notice routes), `components/` (incl. shadcn-style `components/ui`), `hooks/`, `lib/` (incl. `lib/auth`), `content/docs/*.mdx` — the player-facing docs site content.

## Build / run / test

- Root: `pnpm dev|build|test|lint` → delegates to `turbo <task>` across the workspace. `pnpm migrate` / `pnpm generate` target the server (Drizzle).
- Server (`apps/server`): `dev` = `tsx watch src/main.ts`; `build` = `tsc`; `start` = `node dist/main.js`; `test` = vitest; `test:e2e` = vitest with `vitest.e2e.config.ts` against the isolated `docker-compose.e2e.yml` stack; lint/format = Biome (`biome.json`, replaces ESLint/Prettier).
- Web (`apps/web`): standard Next.js `dev`/`build`/`start`; `typecheck`; Biome `check`.
- `docker-compose.yml` (root) brings up the full stack: `emqx` (5.8), `postgres` (16-alpine), `api`, `web`.
- No root-level CI; `apps/web/.github/workflows/pr-checks.yml` covers only the web app.
- `.env.example` (in `apps/server`) documents required vars: `JWT_SECRET`, `EMQX_SYSTEM_PASSWORD`, `PLAYER_ID_SALT`, `ADMIN_SECRET`, `DATABASE_URL`, Steam/Discord OAuth vars, `CHAT_ENABLED`, `TESTING_MODE`, `MOD_INDEX_SYNC_ENABLED`, `GITHUB_TOKEN`, `LAUNCHER_INTEGRITY_SECRET`.

## Domain model (live state is in-memory, not DB)

- `state/lobby.ts` — `Lobby`: id, code, modId, hostId, maxPlayers(16), type(public/private), `players: Map<playerId, PlayerSession>`, metadata, 100-msg chat buffer.
- `state/player.ts` — `PlayerSession`: playerId, steamName, hashed steam/discord IDs, privileges, tosAcceptedVersion, lobbyCode, mute state.
- `state/index.ts` — global Maps for lobbies/sessions + hashed-ID indexes; TTL-based session cleanup.
- Public/matchmade lobbies are additionally persisted to Postgres (`matchmakingMatches`) so they survive restarts; private lobbies are ephemeral/in-memory only.
- Matchmaking: `features/matchmaking/` — solo vs. group queues, ranked vs. casual, ELO via `matchmakingRatings`/`leaderboardCache`, "first report wins" result resolution with `matchResultConflicts` tracking.

## Connection / auth / realtime protocol

1. REST auth (`features/auth`, Steam ticket or Discord OAuth) issues an **HS256 JWT** (`JWT_SECRET`), payload includes playerId, displayName, lobbyCode, etc. Provider IDs are hashed before storage — raw IDs never persisted.
2. The **same JWT is reused as the MQTT password** to connect to EMQX. EMQX calls back into the server's HTTP webhooks for auth:
   - `POST /emqx/auth` — CONNECT-time: verifies JWT, `clientid === playerId`, active session, ToS accepted, not banned.
   - `POST /emqx/authz` — per-topic pub/sub ACL (lobby membership, host-only metadata, spectator grants, chat eligibility).
   - `POST /emqx/webhook` — dispatches `client.connected`/`client.disconnected` EMQX events.
3. Topic scheme: `lobby/{code}/events`, `lobby/{code}/metadata` (retained), `lobby/{code}/players/{id}/info|state|actions`, `lobby/{code}/chat/{id}`, `player/{id}/{subtopic}` (matchmaking, challenge-response), `bmp/notifications/mod-updates` (retained).
4. **Gameplay itself rides over MQTT, not REST**: actions travel as `{action, from, to, params}` envelopes on `lobby/{code}/players/{id}/actions`; the server mostly relays/authorizes these without interpreting them, except for the special `pvp_log_event` action, which it subscribes to server-side to feed the replay-log buffer.
5. Reconnection: `infrastructure/mqtt/grace-period.service.ts` gives a 2-minute grace window before auto-forfeit; `matchmaking.service.ts: restorePlayerMatchSession` restores state.
6. The system/service MQTT client authenticates as superuser via `EMQX_SYSTEM_CLIENT_ID/USERNAME/PASSWORD`.

## EMQX deployment details

- `docker-compose.yml`: `emqx` service (image `emqx/emqx:5.8`), ports 8883 (TLS) / 1883 (plain, dev), mounts `apps/server/emqx/cluster.hocon` (auth/authz webhook wiring + tcp/ws/ssl listener defs).
- `infrastructure/emqx/emqx-provision.service.ts` — idempotently creates the HTTP connector → webhook action → `client_connected`/`client_disconnected` rules via EMQX's management REST API on every boot (since `cluster.hocon` alone can't configure rule_engine/actions in EMQX 5.x). Uses default dashboard creds `admin`/`public`.
- `infrastructure/emqx/emqx-admin.service.ts` — force-kicks a connected client (ban enforcement).
- TLS cert for the `ssl.default` listener comes from a real Let's Encrypt cert for `mqtt.balatromp.com`, bind-mounted read-only from `/root/emqx-certs/mqtt.balatromp.com` on the host into `/opt/emqx/etc/certs` in the container, kept fresh by a certbot deploy-hook that also restarts the `bmp-emqx` container on renewal. (A prior misconfiguration once pointed the listener at nonexistent cert filenames, silently falling back to EMQX's bundled demo cert and breaking every MQTT-dependent feature — worth remembering if TLS/replay-log symptoms reappear.)

## REST API surface (mounted in `routes/index.ts`)

`/api/auth` (Steam/Discord login, refresh, linking, ToS, dev-impersonate), `/api/lobbies` (create/join/leave/chat/report/metadata/spectate), `/api/matchmaking` (queue, leaderboard, ratings, match start/result), `/api/mutes`, `/api/reports`, `/api/runs` (replay log — see below), `/api/stats` (leaderboards/seasons/history), `/api/releases`, `/api/mods` (mod catalog), `/api/webadmin` (moderator/admin-gated: chat-logs, config, match-conflicts, players, bans, seasons, mod profiles), `/emqx` (broker webhooks), `/admin`. Plus `GET /health`.

## Replay log / anti-cheat system (`features/replay-log/`)

- Purpose: replay/spectate/reconnect-catch-up **and anti-cheat**, fed by the client-side Lua recorder emitting `pvp_log_event` actions over MQTT.
- Server buffers events **in memory** per lobby/player (`RunBuffer`/`PlayerBuffer`), lazily creating a `lobbyRuns` row on first event (dedup'd to avoid a host/guest race creating two rows).
- On run end, events are serialized as `[t, opcode, args]` **positional tuples**, JSON → gzip → base64 into `matchRunLogs.compressedEvents` — this exact tuple shape matters; it must match the client's positional timeline reader (`MPAPI.playback.build_timeline`), which reads `ev[1]/ev[2]/ev[3]`, not object keys.
- **Anti-cheat**: client sends a `chk` checksum event (SHA-256 over its canonical event encoding); server independently recomputes the same hash over its own buffer and compares. Mismatches or an implausible elapsed-time/hand-count ratio set `flagReason` (`hash_mismatch` | `elapsed_time_gate`), checked in `matchmaking.service.ts: evaluateAntiCheat` before rating resolution (flags, doesn't block).
- **Schema-v2 card-ref wire format** (documented in a comment block near `canonicalHashInput` in `replay-log.service.ts`): card-referencing opcodes (`play`, `discard`, `sell`, `buy`/`open_pack`/`voucher`, `pack_pick`/`use`, `pack_skip`, `reorder`) encode card identity via `RLOG.card_ref` — a JSON array whose first element's sign disambiguates: positive `id` = already-seen-this-run (`[id, tag...]`), negative `-id` = first-seen (`[-id, kind, ident..., tag...]`, where `kind` is `"pc"` for playing cards or a SMODS ability-set name for Jokers/Tarots/etc.). Up to 3 trailing tags (`e:`/`ed:`/`s:` for enhancement/edition/seal) capture mid-run mutations. Card ids are scoped per-run, assigned in first-reference order — no separate dictionary event.
- Retention: 180-day TTL (`RUN_TTL_MS`) unless flagged (kept indefinitely for moderator review); purged hourly via jobs started in `main.ts`.
- **`GET /api/runs/mine`** — paginated (`page`/`pageSize`, capped 1000/50) list of the authenticated player's runs, backing the in-game "Match History" overlay. **`GET /api/runs/:runId/replay`** — full replay download, participant- or moderator-gated.

## Database (Postgres + Drizzle, `infrastructure/db/schema.ts`, ~24 tables)

`players` (soft-delete via `deletedAt`), `refreshTokens`, `chatLogs`, `actionLogs`, `serverConfig`, `modVersions`, `flaggedMessages`, `reports`/`reportedLobbyMessages`, `chatAllowlist`, `matchmakingMatches`, `matchResultConflicts`, `matchmakingRatings`, `leaderboardCache`, `seasons`, `modBranches`/`modReleases`, `playerBans`, `playerMutes`, `lobbyRuns` + `matchRunLogs` (replay/anti-cheat), `modRegistry`/`modRegistryVersions`/`modProfiles`/`modProfileEntries` (mod catalog + ranked allowlisting), `launcherIntegrityEvents`.

DB is used for durable/audit data (ratings, bans, reports, replay logs, matchmaking-match recovery on restart) and moderation surfaces — not for hot-path live game state, which stays in-memory. EMQX retained messages act as a lightweight "last known state" cache for late subscribers.

## Other docs in-repo

- Root `README.md` — dev setup, docker-compose usage, seeding (`infrastructure/db/seed-speedrun-players.ts`), and a "dev impersonation" workflow for running multiple local game clients against the server (env vars `BMP_IMPERSONATE_NAME`/`BMP_IMPERSONATE_ID`, tied to sibling mod repo `../BalatroMultiplayerAPI/dev/init.lua`).
- `apps/web/content/docs/*.mdx` — player-facing docs site (Fumadocs/MDX): getting started, ranked matchmaking rules/FAQ, gamemodes, rulesets, approved/banned mods, private-server guide. This is user documentation, not architecture.
- `packages/internal/src/index.ts` — public stub explaining the private-package injection pattern used for launcher-integrity and other non-public features.
