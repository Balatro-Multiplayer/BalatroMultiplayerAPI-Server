---
description: Orient on the cross-repo launcher-integrity challenge/response effort (server <-> mod <-> launcher)
---

# Ranked-integrity challenge relay — cross-repo status

**Goal**: the server periodically challenges a Ranked session to prove it's
genuinely running through BET, not just a mod that knows the protocol. The
mod is untrusted — pure relay, never holds a secret. The launcher signs;
the first (login) challenge also binds a hardware fingerprint into that
same signature.

## The three repos — check branch before touching anything
| Repo | Branch | Role |
|---|---|---|
| `new-launcher` | `main` | `RankedSupervisor` answers challenges (HMAC-SHA256), collects+binds hwid |
| `BalatroMultiplayerAPI` | `main` | Pure Lua relay: MQTT `player/{id}/challenge` <-> loopback socket <-> `challenge-response` |
| `BalatroMultiplayerAPI-Server` | `mqtt` (**not** `main` — stale legacy) | Issues challenges, verifies, stores hwid on login only |

This moves across multiple people/sessions/machines — `git fetch` and
confirm the branch before assuming local matches origin.

## Architecture, one paragraph
Server issues `{challengeId, kind: login|periodic, nonce}` over MQTT → mod
relays as `challenge_request` over the already-authenticated AES-256-GCM
loopback socket → `RankedSupervisor::handleChallengeRequest()` computes
`signature = HMAC-SHA256(BET_LAUNCHER_INTEGRITY_SECRET_HEX,
nonce:playerId[:hwidCanonical])`, hwid only on a login-kind challenge → mod
relays `challenge_response` back to MQTT unchanged. Full wire spec + test
vectors: `BalatroMultiplayerAPI-Server/apps/server/src/features/launcher-integrity/HWID_BINDING_SPEC.md`.

## Status
- Built, tested, committed, pushed on all three branches above.
- Server: 606 tests passing.
- Live-verified: the loopback handshake itself (real AES-GCM/HKDF between
  mod and launcher) against an independent implementation.
- **Not** yet live-verified: a full `challenge_request`/`challenge_response`
  round-trip in a real running game.
- **Blocked**: real `ChallengeStrategy.verify()`/`issue()` crypto lives in
  the **private** `bet-launcher-integrity-private` repo, which neither of
  us has access to — until it's registered, the whole ranked-queue gate is
  a server-side no-op.
- **Not attempted**: macOS/Linux (Windows-only so far; Linux additionally
  blocked on the mod's own discovery-file MQTT reader, which doesn't exist).

## Gotchas learned the hard way
- `cmd /c` from a POSIX Bash tool silently no-ops on Windows — route
  `vcvars64.bat`-based builds through a real PowerShell/cmd session.
- Before calling local uncommitted changes "stale," verify the *diff
  direction* (`git diff HEAD origin/main -- file`) rather than eyeballing —
  got this backwards once and nearly discarded real unlanded work.
- Squash-merged PRs make `git merge-base --is-ancestor` return false even
  when the content is fully in `main`/`mqtt` — check content, not ancestry.
