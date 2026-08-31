# Ranked-readiness challenge — spec for `bet-launcher-integrity-private`

This document is a handoff spec, not code. It describes exactly what the real
`ChallengeStrategy.verify()` implementation (in the private
`bet-launcher-integrity-private` repo, injected via `registerPrivate()` — see
this feature's `launcher-integrity.service.ts` for the public-repo side of the
seam) needs to do to support the new `ranked_readiness` challenge kind
described below. Mirrors `HWID_BINDING_SPEC.md`'s own precedent exactly — a
contract to implement against, not a diff, written from the launcher/server
public-repo side without access to the private repo.

## Why this exists

A player's launcher and Ranked-legal mods are only ever verified once, before
the game process launches (`RunController`'s pre-launch pipeline). Nothing
previously re-checked that a player queueing for Ranked mid-session is still
actually current — a release that shipped while they were already playing
would go undetected. `ranked_readiness` closes that gap: the server issues
this challenge right after a Ranked queue join, and the launcher answers with
a signed, self-reported verdict after forcing a fresh check of its own
version and every active Ranked-legal mod's on-disk hash (never trusting
anything it had cached from earlier in the session).

**Trust model, by design**: the launcher self-reports `launcherCurrent`/
`modsCurrent` as booleans — the server does *not* independently re-derive
them from a reported hash list. This exactly mirrors the existing
hardware-fingerprint binding's trust model (self-reported, HMAC-authenticated,
not independently re-derived) — secure as long as the shared secret isn't
extracted from the binary, the same security posture as everywhere else in
this system. Independent server-side re-verification against the mod catalog
is a real future hardening option, deliberately out of scope here.

## Wire contract

New challenge kind, issued by `launcher-integrity.service.ts` right after a
successful Ranked `matchmaking.service.ts::joinQueue` (not at MQTT-connect
time like `login`/`periodic`):

```jsonc
// issued
{ "type": "issued", "challengeId": "...", "kind": "ranked_readiness", "nonce": "..." }

// response, launcher current
{ "challengeId": "...", "response": {
    "signature": "<hex hmac>",
    "launcherCurrent": true,
    "modsCurrent": true,
    "staleModIds": ""
  }
}

// response, mods stale (staleModIds is diagnostic-only - see below)
{ "challengeId": "...", "response": {
    "signature": "<hex hmac>",
    "launcherCurrent": true,
    "modsCurrent": false,
    "staleModIds": "SomeModId,AnotherModId"
  }
}
```

`staleModIds` is a **comma-joined string, not a JSON array** — the mod-side
relay this response passes through (`launcher_thread.lua`'s own JSON
decoder, used when the real `json` library isn't available in that
isolated `love.thread` Lua state) has no array support at all, by design.
A comma-joined string sidesteps that entirely.

// outright refusal (BET_LAUNCHER_INTEGRITY_SECRET_HEX unset for that build,
// or the mod's own supervision channel isn't active) - same shape the
// existing kinds already use
{ "challengeId": "...", "refused": true }
```

`strategy.verify(playerId, issuance, response)` already receives `response`
as `unknown` — **no change needed to the public `ChallengeStrategy`
interface in `packages/types`**. The private implementation branches on
`issuance.kind === 'ranked_readiness'` and, within that, on the response
shape (object with `signature`/`launcherCurrent`/`modsCurrent`, same object
pattern the `login` case already establishes for its own two-shape
response).

## Signature material

HMAC-SHA256 keyed by the same shared secret (`LAUNCHER_INTEGRITY_SECRET`,
matching the launcher's build-time `BET_LAUNCHER_INTEGRITY_SECRET_HEX` — see
the critical key-encoding pitfall in `HWID_BINDING_SPEC.md`, which applies
identically here):

```
expected = hex(HMAC-SHA256(secret, `${nonce}:${playerId}:${launcherCurrent}:${modsCurrent}`))
ok = (response.signature === expected)
```

`launcherCurrent`/`modsCurrent` are interpolated as the **literal lowercase
strings `"true"`/`"false"`**, not JSON `true`/`false` — this is a plain
colon-delimited string being signed, not a JSON serialization, the same
"no serializer to disagree about" reasoning `HWID_BINDING_SPEC.md`'s
`hwidCanonical()` already uses for the same class of problem.

**`staleModIds` is deliberately NOT part of the signed material.** It's
diagnostic detail for server-side logging only (which mod(s) triggered a
`modsCurrent: false` verdict) — the accept/refuse decision depends solely on
the two signed booleans, so tampering with `staleModIds` after signing can't
change the outcome, only corrupt what gets logged. Read it straight off
`response.staleModIds` without verifying it.

## What the public repo already does once `verify()` returns `true`

Not this package's concern, just for context: `handleChallengeResponse`
reads `launcherCurrent`/`modsCurrent` straight off the verified `response`
object (doesn't need them returned from `verify()`). If either is `false`,
it dequeues the player (`leaveQueue`) and publishes `{type:'queue_cancelled',
modId, gameMode, reason}` on `player/<playerId>/matchmaking`, where `reason`
is `'launcher_outdated'` when `!launcherCurrent` (checked first — updating
BET also resolves stale mods on next launch, so that message takes priority
when both are stale) else `'mods_outdated'`. Same treatment for `verify()`
returning `false` or the challenge timing out/being refused outright.

## Test vectors

Computed independently in Python (`hmac`/`hashlib`, stdlib only) — same
secret/nonce/playerId as `HWID_BINDING_SPEC.md`'s own vectors, for easy
cross-reference:

```
secret (hex):  000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e
nonce:         abc123
playerId:      11111111-2222-3333-4444-555555555555

--- launcherCurrent=true, modsCurrent=true ---
input:     abc123:11111111-2222-3333-4444-555555555555:true:true
signature: fae135c5dcf8e4ce50f7623d885f65fd07dc637b5ff3e2dcc0ee7b3c65af952f

--- launcherCurrent=true, modsCurrent=false ---
input:     abc123:11111111-2222-3333-4444-555555555555:true:false
signature: 55747481ed4e349d7083034eb4f573524b41825a5c38e170618ceaca3c295dd5

--- launcherCurrent=false, modsCurrent=true ---
input:     abc123:11111111-2222-3333-4444-555555555555:false:true
signature: bdeeed8404a7506b6c7f2f61e8b38fff08891c40ba2bf5d5e9dcad7637580f9b

--- launcherCurrent=false, modsCurrent=false ---
input:     abc123:11111111-2222-3333-4444-555555555555:false:false
signature: 23654e57e3064c3985856d2ae9682b366fbb6868d3288c726839ecff7d7d212d
```

Use these to sanity-check a fresh implementation before wiring it into the
real `issue()`/`verify()` flow — same as `HWID_BINDING_SPEC.md`'s own
vectors, generated the same way (`hmac.new(bytes.fromhex(secret_hex),
input.encode('utf-8'), hashlib.sha256).hexdigest()`).
