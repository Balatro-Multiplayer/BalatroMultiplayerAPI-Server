# Hardware-fingerprint binding — spec for `bet-launcher-integrity-private`

This document is a handoff spec, not code. It describes exactly what the real
`ChallengeStrategy.verify()` implementation (in the private
`bet-launcher-integrity-private` repo, injected via `registerPrivate()` — see
this feature's `launcher-integrity.service.ts` for the public-repo side of the
seam) needs to do to support the hardware-fingerprint binding described below.
It was written from the launcher/server public-repo side without access to
that private repo, so it's a contract to implement against, not a diff.

## Why this exists

The launcher (BET) collects a per-machine hardware fingerprint for
ban-evasion detection (`hardwarefingerprint.cpp`) and relays it to the server
through the mod, attached to the first ("login") launcher-integrity challenge
of each Ranked Run. The mod is a pure relay with no cryptographic
capability of its own — it never holds the launcher-integrity secret, so it
can forward a signed value but can never forge one.

**Without binding the fingerprint into the same signature as the base
challenge response**, a modified mod could still swap in different hardware
IDs after a real launcher signs the real ones — the base response would still
verify, but the fingerprint riding alongside it in the same message would be
unverified. Binding closes that gap: the fingerprint is part of what's
actually signed, so tampering with it invalidates the signature.

## Wire contract

Unchanged from today for periodic challenges. Extended for login challenges —
`response` becomes an object instead of a bare string:

```jsonc
// periodic (unchanged)
{ "challengeId": "...", "response": "<hex hmac>" }

// login, with a fingerprint attached
{ "challengeId": "...", "response": {
    "signature": "<hex hmac>",
    "hardwareFingerprint": { "platform": "windows", "components": { "steam_id": "...", "disk_serial": "..." } }
  }
}

// login, no fingerprint available this Run (e.g. BET_HWID_PEPPER_HEX unset on
// that launcher build) — falls back to the plain periodic shape
{ "challengeId": "...", "response": "<hex hmac>" }
```

`strategy.verify(playerId, issuance, response)` already receives `response`
as `unknown` — **no change is needed to the public `ChallengeStrategy`
interface in `packages/types`**. The private implementation just needs to
branch on `typeof response`.

## Signature material

Two cases, both HMAC-SHA256 keyed by the same shared secret
(`LAUNCHER_INTEGRITY_SECRET`, matching the launcher's build-time
`BET_LAUNCHER_INTEGRITY_SECRET_HEX` — **see the critical key-encoding note
below before implementing this**):

```
response is a string (periodic, or login with no fingerprint):
    expected = hex(HMAC-SHA256(secret, `${nonce}:${playerId}`))
    ok = (response === expected)

response is an object (login, with a fingerprint):
    canonical = hwidCanonical(response.hardwareFingerprint.platform,
                               response.hardwareFingerprint.components)
    expected  = hex(HMAC-SHA256(secret, `${nonce}:${playerId}:${canonical}`))
    ok = (response.signature === expected)
```

`hwidCanonical(platform, components)`: **deliberately not JSON** — sort
component names lexicographically, format each as `"name=hash"`, join with
`platform` prepended, all separated by `|`:

```ts
function hwidCanonical(platform: string, components: Record<string, string>): string {
	const names = Object.keys(components).sort()
	const parts = names.map((name) => `${name}=${components[name]}`)
	return [platform, ...parts].join('|')
}
```

This exact function is already implemented three times, independently, and
cross-checked against each other:
- `hwidCanonical()` in the launcher's `rankedsupervisor.cpp` (C++, the actual signer)
- `hwidCanonical()` in `launcher-integrity.service.test.ts`'s `makeHmacStrategy` (the public repo's own test-only stand-in for this private package)
- The reasoning above

Avoiding JSON here is deliberate: a JSON-based canonical form would require
byte-identical serialization (key ordering, whitespace, escaping) across
Qt's `QJsonDocument` and whatever JSON library this private package uses —
an easy, silent way to make every single fingerprint submission fail
verification without any error message pointing at why. The `|`-delimited
format has no serializer to disagree about.

## ⚠️ The one pitfall that will silently break everything

`LAUNCHER_INTEGRITY_SECRET` (however it's provisioned to this private
package — env var, secrets manager, etc.) is a **64-character hex string**
representing 32 raw bytes. The launcher's C++ side decodes it once
(`QByteArray::fromHex`) and uses the **raw 32 decoded bytes** as the HMAC
key — never the hex string itself, never a UTF-8 encoding of the hex
characters.

```
CORRECT:   HMAC-SHA256(Buffer.from(secretHex, 'hex'), input)
INCORRECT: HMAC-SHA256(secretHex, input)                 // treats the hex STRING as key material
INCORRECT: HMAC-SHA256(Buffer.from(secretHex, 'utf8'), input)  // same mistake, explicit
```

These produce completely different (and completely wrong) results with no
error thrown anywhere — `verify()` just always returns `false`, and every
Ranked player fails launcher-integrity forever, with nothing in any log to
point at why. **Confirmed empirically**: for a fixed secret/input, the
"correct" and "incorrect" computations above produce different 64-character
digests, not a coincidental match, in every case tried.

## Test vectors

Computed independently in Python (`hmac`/`hashlib`, stdlib only) against the
exact algorithm above — use these to sanity-check a fresh implementation
before wiring it into the real `issue()`/`verify()` flow:

```
secret (hex):  000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e
nonce:         abc123
playerId:      11111111-2222-3333-4444-555555555555

--- periodic (string response) ---
input:     abc123:11111111-2222-3333-4444-555555555555
signature: 5e165d61a01dca30e68b37b3800e95223103f9cb9776ad4da81d244ae3e5920b

--- login (object response, with fingerprint) ---
platform:   windows
components: { steam_id: "deadbeef", disk_serial: "cafef00d" }
            (a third component, board_serial: "", was present but empty in
             the source fingerprint and correctly omitted — collect() never
             emits empty-valued components, see hardwarefingerprint.cpp)
canonical:  windows|disk_serial=cafef00d|steam_id=deadbeef
input:      abc123:11111111-2222-3333-4444-555555555555:windows|disk_serial=cafef00d|steam_id=deadbeef
signature:  de4dfa4ee49daecc1750c116988db215ac7d2e680be97bcef94ea63fb7a8594d
```

## What the public repo already does once `verify()` returns `true`

Not this package's concern, just for context: `handleChallengeResponse` in
`launcher-integrity.service.ts` destructures `hardwareFingerprint` back out
of `response` itself (it doesn't need it returned from `verify()`) and
persists it via `upsertHardwareComponents()` — but only when `active.kind
=== 'login'`, ignoring (and logging a warning on) a fingerprint attached to
a periodic response regardless of what `verify()` says about it. That
defense-in-depth check is independent of this spec and doesn't need
mirroring here.
