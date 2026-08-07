# Moderation service

A stateless verdict API for chat. One endpoint decides, the relay enforces.

It has **no database and no per-player state whatsoever** — a request goes in,
a verdict comes back, and nothing about the message or the player is retained.
Two instances judge the same message identically, and a restart changes
nothing. Anything durable (evidence, mutes, bans) is the caller's business,
deliberately.

Per-player rate limiting is the caller's business too: the relay's chat route
already limits each player, so a second identical bucket here would only
duplicate it. Overload is handled where it belongs — a global ingress valve,
and the guard lane shedding its own backlog.

```
POST /moderate  {playerId, lobbyCode, message}
             →  {verdict: "allow" | "reject", band, latency_ms,
                 publishText?, reason?}
GET  /health →  {status: "ok" | "loading", model_loaded, enforcement,
                 auth, model, model_load_error, build, lists, guard}
```

`publishText` on an `allow` means **publish this instead of what was typed** —
a link stripped, mild profanity softened. The relay publishes the rewrite but
stores the original as evidence.

## Running it

The service is wired into the repo's compose file; from the repo root:

```sh
docker compose up -d moderation
```

Then give it a model (see below). Nothing else is required — the word lists
ship inside the image, so a stock container is already configured.

## The model

The guard model is **not** in the image or the repo — it is far past GitHub's
100MB file limit. The service needs one to do anything.

Put the `.gguf` in the `moderation-model-cache` volume, once:

```sh
docker cp your-model.gguf bmp-moderation:/model-cache/
docker compose restart moderation
```

The filename does not have to match anything. `GUARD_MODEL` defaults to the
`/model-cache` **directory**, so the service loads whatever single `.gguf` is
in there and logs which one. Point `GUARD_MODEL` at a specific file if you
keep several — with more than one present it refuses to guess and says so.

The volume survives restarts, rebuilds and image updates — only
`docker compose down -v` clears it.

Loading takes a few seconds, plus a first judgement to warm up. `GET /health`
reports `model_loaded`, and the startup banner states the posture it came up
in — check it before concluding anything about behaviour.

**When enforcing (`SHADOW_MODE=0`), a missing model refuses every message** —
nothing unjudged is ever published. If players suddenly cannot talk at all,
check `model_loaded` in `/health` before looking anywhere else.

**In shadow mode (the default), a missing or still-loading model publishes
instead**, marked `review` in the log. That mode already publishes everything
the guard would have blocked, so treating "cannot answer" more harshly than
"answered Unsafe" would only ever cost you working chat. The deterministic
tiers still enforce throughout, so this is never unfiltered.

A model that is merely *slow* (deadline, backlog) refuses in both modes — the
model works there, that message just wasn't judged in time, and a retry gets
through. The line is whether a retry could ever succeed.

Roughly 4 GiB of free RAM is needed to load it.

### CPU

Leave the container uncapped, and llama.cpp matches its thread count to the
cores it can see. Capping CPUs **without** also setting `GUARD_THREADS` to the
same number is the one configuration that fails badly rather than gracefully:
llama.cpp threads spin-wait, so oversubscription collapses throughput (a ~2s
judgement becomes 20–40s). Change both together or neither.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GUARD_MODEL` | `/model-cache` | Model file, or a directory holding exactly one `.gguf`. |
| `SHADOW_MODE` | `1` in compose | `1` = log what the guard *would* block without blocking. `0` = enforce. |
| `GUARD_THREADS` | all visible cores | Only set this alongside a CPU cap — see above. |
| `MODERATION_BEARER_TOKEN` | unset | Optional `Authorization: Bearer`. The service publishes no host port, so a network boundary already protects it; set one before exposing it. |
| `PORT` | `8001` | |
| `ALLOWLIST_PATH` / `REWRITES_PATH` / `APPROVED_DOMAINS_PATH` | bundled copies | Override the shipped word lists. |
| `MODERATION_REQUIRE_LISTS` | `0` | `1` turns an unreadable configured list into a startup failure instead of a silent degrade. |

`SHADOW_MODE=1` only relaxes the **model** tier — the deterministic tiers
(threats, blocklist, PII, rewrites) enforce in both modes. It
also covers a model that is absent entirely (see above); a model that is
merely late still refuses even in shadow mode.

## How a verdict is reached

Tiers run in order of how *certain* they are, not how severe — the cheap
certain checks settle most traffic before the model is asked anything:

1. **transform** — strip unapproved links, apply rewrites
2. **threats** — explicit violence, always blocks
3. **allowlist** — a fast-pass for known-good phrasing; about 60% of real
   chat short-circuits here (`good luck have fun`: 1301ms → 1ms)
4. **blocklist** — slurs and the like
5. **PII / contact exchange** — safety, not manners
6. **guard model** — everything still undecided

A message that reaches the end without a usable guard verdict is refused —
except an absent model in shadow mode, which publishes as `review`.

## Tests

```sh
pnpm --filter balatro-multiplayer-moderation test
```

The pipeline is a pure core: every tier is unit-testable with plain strings
and no model, no network, and no fixtures.
