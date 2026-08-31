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

The service is wired into the repo's compose file as 5 replicas
(`moderation-1`..`moderation-5`) behind an internal load balancer
(`moderation-lb`) — see [CPU](#cpu) for why it's 5 processes rather than one
bigger one. From the repo root:

```sh
docker compose up -d moderation-1 moderation-2 moderation-3 moderation-4 moderation-5 moderation-lb
```

Then give it a model (see below). Nothing else is required — the word lists
ship inside the image, so a stock container is already configured.

## The model

The guard model is **not** in the image or the repo — it is far past GitHub's
100MB file limit. The service needs one to do anything.

**Quantize before staging.** The training pipeline exports F16 (unquantized)
`.gguf` files — this doubles the per-weight memory-bandwidth cost the model
pays on every inference versus a quantized one, for no accuracy benefit on a
classification/reranking task. Convert to Q8_0 first (needs a `llama-quantize`
build — `llama.cpp`'s own tool, vendored under `node-llama-cpp`'s install, or
build from source):

```sh
llama-quantize your-model.gguf your-model.Q8_0.gguf Q8_0
```

Live-benchmarked on an EPYC 9645 (12 vCPU): quantizing gave a 31-66%
throughput improvement across every thread/replica configuration tried, with
`model.fileInsights.supportsRanking` confirmed still `true` afterward — this
is a one-time, low-risk conversion, not a retrain.

Put the `.gguf` in the `moderation-model-cache` volume, **once** — all 5
replicas share it (see [CPU](#cpu)):

```sh
docker cp your-model.Q8_0.gguf bmp-moderation-1:/model-cache/
docker compose restart moderation-1 moderation-2 moderation-3 moderation-4 moderation-5
```

Each replica only reads the model at its own process boot (`rankEngine.ts`'s
`loadRankingContext`), so staging happens exactly once but every replica
needs its own restart to pick it up. Keep **exactly one** `.gguf` in the
volume — `GUARD_MODEL` defaults to the `/model-cache` **directory**, and with
more than one file present the service refuses to guess which to load and
says so (every replica fails closed identically, since they share the same
volume). Point `GUARD_MODEL` at a specific file instead if you need to keep
several around.

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

**Why 5 replicas instead of one bigger instance.** Each process gets exactly
one node-llama-cpp `RankingContext` (`rankEngine.ts`'s `loadRankingContext`),
and `JudgeLane` (`service.ts`) doesn't queue or parallelize concurrent
requests across it — it only sheds ones that can't meet their deadline.
`GUARD_THREADS` controls intra-inference parallelism (splitting *one* forward
pass's matrix math across threads), not concurrent-request throughput, so
past a point, raising it just makes each individual call faster without
letting more calls run at once. Separate OS processes don't have that
ceiling — five of them can each answer a request in true parallel across
distinct cores.

This was measured live, not assumed: on an EPYC 9645 (12 vCPU, 2 cores
reserved for the rest of the stack), single-lane throughput climbed nearly
linearly with `GUARD_THREADS` up through 12 (unlike the old generative
guard, which plateaued hard past 4), but splitting the same core budget
across more, smaller lanes still won outright — 5×`GUARD_THREADS=2` measured
**6.50 msg/sec** aggregate (quantized model) vs. **4.15 msg/sec** for one
`GUARD_THREADS=10` instance. Oversubscribing threads past the real core
count (`GUARD_THREADS=16`+ on 12 real cores) made things *worse*, not
better — this isn't "more threads always helps," it's "more independent
processes helps, more threads per process has a ceiling." This is a
single-session measurement on one box, not a formal load test — worth
re-checking after any change to hardware, replica count, or model.

Compose therefore ships 5 named replicas (`moderation-1`..`5`) behind
`moderation-lb`, each defaulting `GUARD_THREADS=2` (tunable via
`MODERATION_GUARD_THREADS`, applied to all 5 — see [Configuration](#configuration)).
Replica *count* itself isn't env-var-driven — retuning it means editing
`docker-compose.yml`'s `moderation-1`..`5` blocks directly, same tradeoff the
existing blue/green pair already accepts for its own (2-way) replica count.

Independent of replica count: capping a single container's CPUs below its
own `GUARD_THREADS` is the one configuration that fails badly rather than
gracefully — llama.cpp threads spin-wait, so oversubscription collapses that
container's throughput. Change both together or neither, per replica.

## Configuration

Per-container env vars, as read by `apps/moderation/src/main.ts` inside each
replica:

| Variable | Default | Meaning |
|---|---|---|
| `GUARD_MODEL` | `/model-cache` | Model file, or a directory holding exactly one `.gguf`. |
| `SHADOW_MODE` | `1` in compose | `1` = log what the guard *would* block without blocking. `0` = enforce. |
| `GUARD_THREADS` | `2` | Only set this alongside a CPU cap — see [CPU](#cpu). |
| `GUARD_LOW_THRESHOLD` / `GUARD_HIGH_THRESHOLD` | `0.35` / `0.8` | Routing thresholds against the model's yes-probability score — see `rankEngine.ts`. |
| `MODERATION_BEARER_TOKEN` | unset | Optional `Authorization: Bearer`. The service publishes no host port, so a network boundary already protects it; set one before exposing it. |
| `PORT` | `8001` | |
| `ALLOWLIST_PATH` / `REWRITES_PATH` / `APPROVED_DOMAINS_PATH` | bundled copies | Override the shipped word lists. |
| `MODERATION_REQUIRE_LISTS` | `0` | `1` turns an unreadable configured list into a startup failure instead of a silent degrade. |

Compose-level indirection (`docker-compose.yml`'s `moderation-1`..`5`
blocks), applied uniformly to all 5 replicas — set these instead of
`GUARD_THREADS` directly when invoking `docker compose`, since the
per-container var above is itself sourced from these:

| Variable | Default | Meaning |
|---|---|---|
| `MODERATION_GUARD_THREADS` | `2` | → each replica's `GUARD_THREADS`. |
| `MODERATION_GUARD_LOW_THRESHOLD` / `MODERATION_GUARD_HIGH_THRESHOLD` | `0.35` / `0.8` | → each replica's `GUARD_LOW_THRESHOLD` / `GUARD_HIGH_THRESHOLD`. |
| `MODERATION_BEARER_TOKEN` | unset | → each replica's `MODERATION_BEARER_TOKEN` (same var name, just also settable at the compose level). |

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
