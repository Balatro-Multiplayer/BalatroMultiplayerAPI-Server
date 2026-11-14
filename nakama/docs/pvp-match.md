# The PvP match contract

This file describes how a PvP match works between the game clients and the Nakama
server. It is the public contract. A reader needs no other file.

The short version:

- Clients report facts. A client says "I scored this", "I lost this blind", "I
  forfeit". It never says who won or how many lives anyone has.
- The server decides. It reads the facts, applies the rules, and keeps the
  one record of lives, rounds, targets and the result.
- Clients draw the match state. The server sends that state as a set of
  `pvp.*` keys. A client shows what the keys say.

The rest of this file is the wire (how messages travel), then ten numbered
sections, then the appendix of numbered rules (R1 to R55). Code comments in
`nakama/src` cite these sections and rule numbers.

## Wire

Match state travels in four messages. Every message is a Nakama match message with
an op code.

| Direction | Op | Name | Body |
|---|---|---|---|
| client to server | 8 | REQUEST | `{v:1, reqId, type, payload}` |
| server to client | 114 | ANSWER | `{reqId, ok:true, rev}` or `{reqId, ok:false, reason}` (a refusal recorded in the state adds `rev`; a `bad_rules` refusal adds the optional `key` it names). Sent to the sender only. |
| server to client | 115 | STATE | `{rev, changed:{<key>:<value>}, full?:true}`. Sent to every seated player, with the score mask applied per player (section 4a). |
| server to client | 100 | SNAPSHOT | The join and rejoin snapshot, plus `{rev, connectionId, protocol, match:{<key>:<value>}}`. `match` is masked for that player too. |

Protocol version:

- `PROTOCOL_VERSION` is 1.
- The SNAPSHOT carries `protocol` as a number. A join sends no `protocol`, and no
  join is refused for it: a PvP lobby is gated by the PvP version only (section 1).
- The `v` in a REQUEST is informational: the server does not read it. Compatibility is
  decided by the SNAPSHOT `protocol`, which the client reads before it sends anything.
- A client that gets a SNAPSHOT with no `protocol` is talking to an old server and
  answers every request itself with `not_supported`.

The `pvp_protocol` RPC lets a client check the server before it queues:

- The payload is empty. The answer is the JSON `{"protocol":1}`. The number is the
  constant `PVP_PROTOCOL` in `nakama/src/pvp_protocol.ts`, and it is raised only with a
  change older clients cannot play.
- A client refuses to queue or to create a lobby when the RPC is missing (an old
  server) or the number is below its own floor.
- It is not the SNAPSHOT's `protocol` above, which describes the match messages once a
  client is in a lobby.

Refusals before a game (the code is the whole message of the error):

- `mode_disabled`: the mode is switched off in the server config
  (`disabledPvpModes`). It is refused when a ticket is added (casual or ranked), when a
  ranked lobby is created, and when a game starts. Switching nemesis off switches ranked
  off with it.
- The switch is set with the `admin_config_set` RPC, for example
  `{"disabledPvpModes":["royale"]}`; an empty list switches every mode back on. The value
  must be a list of known modes (`royale`, `nemesis`, `manhunt`, `teams`), each at most
  once. Anything else is refused with `INVALID_ARGUMENT` and the stored list stays as it
  was. A stored value that is malformed anyway reads as no mode switched off and is
  logged as a warning.
- The switch stops new games. It does not stop a restart in a lobby that is already in a
  game, so a running lobby keeps playing the mode it started with.
- The mode a game starts with is fixed from the start on: a metadata write that changes
  `queue_mode` while a game is started (including in the batch right after the start, and
  after a restart) is refused with `bad_rules` naming `queue_mode`. The same value is
  accepted. So a host cannot start an enabled mode and switch to a disabled one, and a
  restart cannot change the mode.
- A PvP ticket from a client below `1.1.0` is refused when it is added, with the same
  text as a lobby join (`PVP_UPDATE_REQUIRED`, section 1), so such a
  ticket never enters the pool. A group queue refuses the member the same way.

Request ids and exactly-once apply:

- A `reqId` is `"c<n>:<counter>"`: the connection id, then a counter that starts at 1
  for each connection. The server never parses it. It must be a non-empty string of at
  most 64 characters. A request with no usable `reqId` gets no answer.
- The server keeps the last 64 answers it stored for each player. A request whose
  `reqId` is already stored gets the stored answer again and changes nothing.
- Every `ok:true` answer is stored. Every refusal is stored too, except `rate_limited`
  and `no_seat`, which depend on when the request arrives and not on what it asks.
- A player's stored answers are dropped when their seat is removed (leave, kick, grace
  expiry). They are kept when the player only disconnects.
- Requests spend the same rate budget as relayed actions. Over budget the answer is
  `rate_limited`. A request from an away player does not mark them back: the session
  gate drops an away player's messages, and only a rejoin (a join) marks a seat back.
- Wire refusals that apply to every request type: `no_seat` (the sender has no seat),
  `rate_limited`, `bad_payload` (no `type`), `unknown_type`.
- An empty object that a client encodes as `[]` is read as `{}`.

Revisions and catch-up:

- `rev` starts at 1. It goes up by exactly one for each step that changes match state
  and pushes a STATE. Refusals, dedupe hits and requests that change no key do not
  change it.
- A client drops a STATE whose `rev` is at most its own. It applies a STATE whose `rev`
  is exactly its own plus one. On any other value (a gap) it sends the request
  `snapshot` and ignores STATE messages until that answer arrives.
- The request `snapshot` has the payload `{}` and always answers `ok:true`. The server
  first sends that player a STATE `{rev, full:true, changed:<every key>}` and then the
  ANSWER. A snapshot answer is never stored, so a resend gets a fresh full STATE.
- A `full:true` STATE is applied whenever its `rev` is at least the client's own, even
  while the client waits for a snapshot answer. That ends the wait.

Idle values: a lobby with no PvP game sends every key with its idle value (section 4).
A key is never `null` as a whole, because a client cannot delete a key with a `null` in
a STATE that is not full.

## 1. Gate

The match rules apply to PvP lobbies only.

- A lobby is a PvP lobby when its mod id is `MultiplayerPvP`. Every game in a PvP lobby
  is refereed by the server. There is no host fallback.
- A join to a PvP lobby is refused when the joiner's reported PvP version is missing or
  below `1.1.0`. The refusal reason is `PVP_UPDATE_REQUIRED` and the text is:
  "PvP needs MultiplayerPvP 1.1.0 or newer. Update the mod and try again." (built from
  `MIN_PVP_VERSION`, so the number cannot drift)
- The check runs after the other join checks (closed lobby, full lobby, wrong mod), so
  those keep their own reasons. A returning seat is checked too.
- Lobbies of any other mod (the Speedrunning mod, for example) are not touched. They get
  every idle value from section 4, and the PvP tick (section 2) does nothing in them.

## 2. The one decision home

- Reducers record facts. A request reducer checks the payload, records the sender's
  fact, and answers only "accepted" or "refused, and why". It decides nothing else.
- The PvP tick decides. It runs once per loop step, after the step's messages are
  applied and before the game-result check. Every round resolution, life change,
  pending death, vote outcome and winner is decided there.
- The tick is the only writer of lives. No request changes a life count.
- The tick alone makes every run-out and writes the deadline; no client request files one.
- The tick reads facts once. The fact log has an `applied` index; the tick reads from
  that index and moves it, so each fact has its effect exactly once.
- The tick is a pure function. It takes plain state and a context
  `{now, random, newId, newSeed}` and returns plain state. A thin shell reads and writes
  the lobby and sends the STATE.
- Mode hooks are pure too. Each is a function from state and context to state:

| Hook | What it does |
|---|---|
| `init` | Settles the roster and lives once, at the start of a run. |
| `roundReady` | Opens a round with the start's hands. |
| `resolveRound` | Decides that a round is over and names the losers. Never touches lives. |
| `voucherGainers` (optional) | Names who gains a life from a Manhunt voucher. |
| `mayRedeemVoucher` (optional) | Says who may redeem a voucher. Without it every voucher is refused `not_runner`. |
| `lifePool` (optional) | A shared life pool (Teams): who shares a loss, the pool's drop, who pays per lost round. |
| `opensSideDeath` (optional) | Manhunt: whether a player at 0 lives opens the pending death of a side (only the Runner does). |
| `checkWinner` | Writes the result when the game is decided. |
| `onAnte` (optional) | Runs when a new ante starts between rounds (re-pairing, targets). |
| `onForfeit` | Runs when a seat forfeits or leaves. |
| `view` (optional) | Says who targets whom, for `pvp.targets`. Nothing is stored. |

- The rule set is chosen once per game from the mode and the number of players that
  started. Manhunt and Teams use their own rules. Otherwise exactly two players use the
  duel rules. Nemesis with more than two players uses the Nemesis rules. Standard and
  Royale with more than two players use the Royale rules.
- Two data fields on the mode tell the shared code the rest: `deathPolicy` (`opponent`, `everyone`,
  `side` or `none`: who a death on a normal blind waits on, R11, R32, R45, R53) and
  `outOfHandsOnFail` (a lost blind or a timer run-out puts the player out of hands, R34;
  false for the duel). The shared code never asks which mode it is.
- Adding a mode: write one file in `modes/` that exports a `Mode` (start from the helpers in
  `modes/common.ts`), and register it in `pickMode` in `modes/index.ts`, the only place that
  maps a mode name to a mode. No shared rule code changes (only the name goes into `ModeName`, and into the queue mapping in `settings.ts` if a lobby queue starts it); `modes/types.ts` has the checklist.
- Where the code is, under `nakama/src/lobby/pvp/`: `facts.ts` and `timer_facts.ts` hold the
  reducers; `tick.ts` is `decide`; its steps are `lives.ts` (the one writer of lives),
  `deadline.ts` (timers), `round_cycle.ts` (round resolution and opening) and `deaths.ts`
  (pending deaths); `referee.ts` is the shell that reads and writes the lobby; `state.ts`
  holds the state types (its header says who may change which); `settings.ts` reads the
  settings frozen at the start; `modes/` holds the mode hooks.
- Each request payload carries `runId`. A `runId` that does not match the running game
  gets `round_over` and changes nothing.
- `blindKey` is `"<ante>:<Small|Big|Boss>"`, for example `"3:Boss"`. A negative or
  fractional ante is malformed.
- `roundId` is the number in `pvp.round.roundId`: the id of the start that opened the
  round. It is 1 at the first start and 0 before it. Only the tick writes it, and only a
  `pvp.ready` start moves it. A resolve keeps it. If a new start arrives while a round is
  still playing, everyone has left that blind, so that round closes first with no losers
  and no life lost.
- Scores travel as strings (the game's big-number text). The server parses and compares
  them in one place, `nakama/src/lobby/pvp/score.ts`.

## 3. Requests

Fact requests (everything except `pvp.ready`, `pvp.unready`, `pvp.team` and the two
timer requests, which have their own rows) share one gate, in this order:

1. `not_running`: no game is started, or the lobby is not a PvP lobby.
2. `no_seat`: the sender is not one of the players the game started with. Not stored.
3. `bad_payload`: the payload has the wrong shape.
4. `round_over`: the `runId` is stale, or `pvp.result` is already set.
5. `eliminated`: the sender is out of the run (no lives, forfeited or left).
   `pvp.forfeit` is exempt.

Requests that need no state change answer `ok:true` and change nothing (a repeat of an
accepted request, for example). Such an answer causes no `rev` bump and no STATE.

| Type | Payload | Refusals after the gate | What it records |
|---|---|---|---|
| `pvp.ready` | `{runId, roundId, blindKey}` | `no_game`, `no_seat`, `bad_payload`, `round_over`, `bad_round`, `not_pvp_blind`, `eliminated` | The sender is Ready on the blind they pressed Ready on. The Ready carries no hand count; the hands come from `pvp.blind_start`. When every required player is Ready the round starts (R8, R9). A repeat Ready is accepted and changes nothing. A Ready on the blind key the sender's round started on, pressed while that round is still open (in the start countdown or while it plays), is `round_over`: it would open the next round at once. Once the round resolved, the same key is accepted. |
| `pvp.unready` | `{runId, roundId}` | `no_game`, `no_seat`, `bad_payload`, `round_over`, `bad_round` | Drops the sender's Ready. |
| `pvp.hand` | `{runId, roundId, score, handsLeft, timerLossesApplied}` | `bad_payload`, `bad_score`, `round_over`, `eliminated`, `not_playing`, `no_entry`, `hands_spent`, `stale_hand`, `commit_mismatch` | The sender's round score and hands left. `timerLossesApplied` is how many PvP-timer run-outs the client had already taken off `handsLeft`; it must be a count no larger than the server's own, else `bad_payload`. The server stores the reported count and its own run-out count and derives `handsLeft = max(0, reported - (timerLosses - applied))`. A hand after the server ended the hands (`handsSpent`) is `hands_spent`. Within one `roundId`, `handsLeft` only goes down and `score` only goes up. A higher `score` needs a hand spent (a lower `handsLeft`) or a newly applied timer loss (a higher `timerLossesApplied`); a higher score with neither is `stale_hand`. A `timerLossesApplied` below the one already stored is `stale_hand` too. When a `pvp.hand_commit` is pending, a hand whose derived count is the committed one is credited as usual and clears the commit; a hand whose derived count is BELOW it (the hand the commit announced was lost on the wire, and scores are cumulative) clears the commit too and is credited once, so one lost hand never blocks the rest of the round; a derived count above the committed one is `commit_mismatch` and the commit stays pending. Only a hand that was played: a first hand that scores 0 is stamped and counts like any other. The best score of the round is kept as `highestScore`. |
| `pvp.hand_commit` | `{runId, roundId, handsLeft, timerLossesApplied}` | `bad_payload`, `not_running`, `no_timer`, `round_over`, `eliminated`, `not_playing`, `no_entry`, `hands_spent`, `stale_commit` | Sent when Play is pressed in the PvP blind, before the hand scores, so the server can credit its hand time ahead of the animation. `handsLeft` is the count after the hand, derived like `pvp.hand`'s. Accepted only while the round plays, for exactly the next hand, with no commit already pending and with hand time left to credit; anything else is `stale_commit` and the hand plays with no credit. A ruleset with no PvP hand clock answers `no_timer`. The next `pvp.hand` is bound to the committed count: the same count (or a lower one, see `pvp.hand`) clears the commit; a higher one is refused `commit_mismatch` and the commit stays pending. |
| `pvp.blind_start` | `{runId, roundId, handsLeft, score, timerLossesApplied}` | `bad_payload`, `round_over`, `not_playing`, `no_entry` | The hands the sender's PvP blind starts with (0 to 100), sent once after the blind's setup effects ran. Sets the round entry's reported hands, score and applied count (run-outs accepted since are subtracted by the same derivation as for a hand) and publishes `pvp.round`, but plays no hand: it does not stamp `handRound`, so the score mask waits for the first real hand. A repeat with the same count changes nothing, and once the sender has played a hand of the round it changes nothing. Until it arrives the player's round facts are unknown (`null`): the viewer is masked, no timer can start on them and they do not count as out of hands. |
| `pvp.blind` | `{runId, blindKey, beaten, roundLost}` | none beyond the gate. `beaten` and `roundLost` both true is `bad_payload`. | A blind result. A failure is final (R12). `beaten:false` alone only records the failure. A life is lost only when `roundLost` is true (R4). The report is also noted so the server knows which blinds the player has reported (section 8). |
| `pvp.timer_start` | `{runId, kind, roundId?}` | `round_over`, `not_playing`, `not_ready`, `nobody_to_time`, `no_opponent`, `not_ahead` | A timer start (section 8). `kind` is `"ante"` or `"pvp"`. `roundId` is required for `"pvp"`. The server always counts, so a payload with a `clock` or an `ms` is `bad_payload`; a ruleset with no clock of that kind (Ante: none, PvP: no hand timer) answers `no_timer`. A start while a timer runs is accepted and changes nothing. |
| `pvp.skip` | `{runId, skips, blindKey}` | `bad_payload` (no `blindKey`, or not `<ante>:Small|Big|Boss`), `not_skippable` (a Boss key), `round_over`, `not_running`, `stale_skips`, `no_progress`, `ahead_of_progress`, `over_cap` | The sender's run total of skips (`G.GAME.skips`), a whole number, after skipping the Small or Big `blindKey`. A lower total than the recorded one is `stale_skips`; an equal one is accepted and changes nothing. After those checks the total is capped by the ante the sender reported with `pvp.progress`: no ante reported yet is `no_progress` (unknown is refused, never 0), a `blindKey` ante above it is `ahead_of_progress`, and a total over two skips per ante (`2 * ante`) is `over_cap`. In Manhunt the two ante-lowering vouchers (`v_mp_hieroglyph`, `v_mp_petroglyph`) let a run replay two antes, so its cap is `2 * (ante + 2)`; no other mode changes. Published in `pvp.skips`. |
| `pvp.sell` | `{runId, ante}` | `bad_payload`, `no_progress`, `bad_ante` (the `ante` is below 1 or more than one above the progress ante) | One sell of the sender's, counted under `ante`. Published in `pvp.opponent` (`sells`). |
| `pvp.shop` | `{runId, spent}` or `{runId, skipped:true}` | `bad_payload` (both fields, or a bad value), `over_cap` (past the slot bound), `no_progress`, `implausible` (a spend over the bound), `skip_missing` (a skipped slot with no unspent `pvp.skip`), `bad_spend` (neither field) | The sender's next blind slot: what the shop spent, or that the blind was skipped. `no_progress`, `implausible`, `skip_missing` and `bad_spend` are kept as a refused slot with the reason. Published in `pvp.opponent` (`slots`). |
| `pvp.effect` | `{runId, kind}` | `bad_payload`, `unknown_kind`, `no_progress`, `over_cap` | An effect the sender sends to their targets. The client names only the `kind` (`asteroid`, `pizza`, `gambling`); the server owns the amount and the targets: Pizza and Gambling reach every other alive player (teammates included), Asteroid reaches every alive player whose frozen `pvp.nemesis` row for the sender's ante has the sender as its target. An empty target list is recorded against nobody. Published to each target in `pvp.effects`. |
| `pvp.trap_plant` | `{runId, key}` | `bad_payload` (anything but the key, for example a serialized card), `unknown_trap` (a key that is not a `c_mp_` key of at most 64 characters), `no_progress`, `over_cap` | The server makes one trap record per target of the sender's frozen row, owned by the sender. A planter holding a live Arcane Lock bounces to the oldest one. Published in `pvp.traps`. |
| `pvp.trap_fire` | `{runId, trapId, data?}` | `bad_payload` (a bad `trapId`, or `data` that is not an object or is over 512 characters of JSON; an Arcane Lock never takes a client fire), `not_running`, `round_over`, `eliminated`, `not_holder`, `already_fired` | The holder springs a live trap; the server records the `data` as sent (`{}` when there is none). Published in `pvp.traps`. |
| `pvp.trap_lost` | `{runId, trapId}` | `bad_payload`, `not_running`, `round_over`, `eliminated`, `not_holder`, `already_fired` | The holder reports an unfired trap card destroyed. Published in `pvp.traps`. |
| `pvp.timer_spend` | `{runId, ms}` | `bad_payload`, `round_over`, `not_running`, `timer_running` | A cost the sender pays out of their own Ante bank (a whole number of ms above 0), never below 10 seconds. Refused while the sender holds, or is timed by, a running deadline. |
| `pvp.timer_pause` | `{runId}` | `not_starter` | The starter stops the timer. With nothing running it is accepted and changes nothing. |
| `pvp.animating` | `{runId, animating}` | `bad_payload`, `round_over`, `eliminated`, `not_running`, `no_seat` | The sender's client starts or stops animating (`animating` is a boolean). While it is true, server-counted deadlines that time the sender stand still and the sender's Pressure clock stops (section 8). A repeat of the current value changes nothing. |
| `pvp.progress` | `{runId, ante, furthestBlind}` | none beyond the gate | The sender's ante and furthest blind, both only going up. The last reported ante is also kept apart, because a Manhunt voucher can lower a player's own ante. Drives Nemesis re-pairing (R28) and the Runner's ante 9 win (R41). |
| `pvp.voucher` | `{runId, voucherKey}` | `bad_payload` (the key is not a string of 1 to 64 characters), `not_runner`, `already_redeemed` | A Runner's ante-skip voucher, once per `runId` and `voucherKey`. The life it gives is the tick's (R42). |
| `pvp.forfeit` | `{runId}` | `eliminated` | The sender has forfeited. The tick decides what follows (R20, R33, R43, R52). A repeat forfeit is accepted. `eliminated` is the answer when the sender is out some other way. |
| `pvp.vote` | `{runId, kind, yes}` | `no_vote` | The sender's vote. `kind` is `"draw"` or `"seed"`. `no_vote` means the rules are not frozen for this run yet. A vote of the same value again changes nothing (R13). |
| `pvp.team` | `{team}` | `no_seat`, `running`, `bad_team` | The sender's team pick, before the game starts. `team` must be one the lobby's mode offers: `A` or `B` for Teams, `RUNNER` or `HUNTER` for Manhunt. The start settles the picks (R35, R46). |
| `snapshot` | `{}` | none | Sends a full STATE (see Wire). |

Notes on the table:

- `pvp.ready` names its blind. `blindKey` must match `^\d+:(Small|Big|Boss)$`, or the
  answer is `bad_payload`. A Small or Big blind is `not_pvp_blind`. Any Boss is accepted
  at any ante: a Manhunt voucher can lower a player's ante after the PvP Boss was set,
  and that Boss stays the PvP blind, so the ante cannot be checked here. The check order
  is seat, round, blind, then `eliminated`.
- `pvp.ready` and `pvp.unready` use `no_game` (not `not_running`) when no game is
  started. They report `round_over` when the `runId` differs or `roundId` is not above
  the rounds started so far, and `bad_round` when `roundId` is more than one above it.
- The Ready request and the fact requests both need a seat in the started game.

Actions of the base mod API that a refereed game refuses with the reason
`server_referee`: `mpapi_report_result`, `mpapi_set_result_pending` and
`mpapi_restart_game`. The result comes from the referee, and a restart happens only
through a passed seed vote.

`mpapi_abandon_game` in a refereed game is a forfeit by the requester, the same as
`pvp.forfeit`. A sender who is not a participant is refused with `not_participant`. If
there is nothing left to decide (the sender is out, or the game is over) it is accepted
and records nothing.

### Refusals on the wire (sell, shop, effect, trap_plant)

An opponent action (sell, shop slot, effect, trap) taken while the player is offline is
lost if the game crashes before they reconnect: pending requests are not saved.

The `reqId` is the only exactly-once rule: the same `reqId` again gets the stored
answer and changes nothing. A request has no sequence number, so the same request under
a new `reqId` is a new request.

- A refusal is answered `{reqId, ok:false, reason}` with no `rev`, and changes nothing
  (a `bad_rules` refusal also carries the optional `key` it names),
  with one exception: a shop slot refused `no_progress`, `implausible`, `skip_missing`
  or `bad_spend` (a shop request with neither `spent` nor `skipped`: the slot happened,
  its spend is unknown) is kept in `pvp.opponent` with its reason, so the slot is used
  and `rev` moves. That answer is `{reqId, ok:false, reason, rev}`, with the `rev` the
  change is in.
- `bad_payload` is a missing or bad `runId`, or a field of the wrong shape. It records
  nothing.

## 4. Match state keys

Each key is a projection of the lobby, built fresh on every read, so no internal field
(the fact log, the tick's index) leaks. Idle values are never `null` as a whole key. A
lobby with no PvP game, or any non-PvP lobby, sends every idle value.

### `pvp.ready`

```json
{"runId":"r-abc","round":3,"ready":{"u1":true},"firstReady":"u1",
 "lastStart":{"roundId":3,"firstPlayer":"u2","players":["u1","u2"]}}
```

- `round` is the number of rounds started so far (0 at the start of a game).
- `firstReady` is the player who pressed Ready first among those still Ready.
- `lastStart` is the last round start, and is `null` before the first one. Its `players` are the players who were Ready at the start, in Ready order; a player who joins or rejoins later is not added.
- Idle: `{"runId":null,"round":0,"ready":{},"firstReady":null,"lastStart":null}`

### `pvp.rules`

Frozen when the run begins: at the first replay event of the game (`raceStartedAt`) or
at the first freezing `pvp.*` request, whichever comes first, by the tick or by the
request shell (freezing twice for one run changes nothing). Every `pvp.*` kind freezes
first, `pvp.ready` and `pvp.unready` included, except `pvp.forfeit` and `pvp.vote`. Only
the first replay event (`raceStartedAt`) means the run began, though: until it arrives
the tick decides nothing but a leave or forfeit, whether or not a request already froze
the rules, and that leave is handled as section 7 says. So a request that arrives during
the Draft (a `pvp.progress` from the player who stayed) cannot turn a dodge into a rated
forfeit. The server owns "Setup finished" (`setupPending`, freeze_env.ts). Until then
nothing freezes the rules and no event stamps `raceStartedAt`: a freezing request is
refused `setup_open`, and a replay event is recorded without starting the race. Setup is
pending while a step is open; in a ranked game of two until the Draft result exists (every
ranked queue is a Nemesis duel with a Draft), which covers the time before the host opens
the Draft and the reveal between steps; and in a casual PvP game while a closed ruleset vote
(step id `ruleset`) is not yet written to the metadata. So a ruleset vote that resolves
during Setup (a host `set_metadata`) is still accepted, and it is the ruleset that freezes.
The gate holds only before the freeze: once the rules are frozen or the race began, a
freezing request is never refused for Setup, so a step the host opens after the freeze
holds no opponent's facts. Once the race began the host cannot open a Draft or a vote
(`run_started`); a freeze alone does not refuse one, so a casual Draft that a forged request
froze the rules ahead of still opens. A ranked game whose host
never opens the Draft stays before its run: only a leave or a forfeit is decided there. A new run starts with nobody animating: the freeze resets
`animating` (an entry found there is a leftover of the last run).

```json
{"runId":"r1","mode":"royale|nemesis|manhunt|teams","startedCount":2,
 "startingLives":4,"hunterLives":7,"pvpStartAnte":2,"deathOnRoundLoss":true,
 "clocks":{"ante":"none|bank|personal","pvp":null,"personal":null}}
```

- Idle: `{"runId":null,"mode":null,"startedCount":0}`
- The settings come from the host-written lobby metadata, which the client always writes
  in full. The server invents no default: a missing or malformed key is `bad_rules`
  naming the key. The keys are checked in this order, the first bad one is named:
  `ruleset`, `queue_mode`, `starting_lives`, `manhunt_hunter_lives`, `pvp_start_round`,
  `timer_base_seconds`, `timer_forgiveness`, `timer_increment_seconds`.

| Field | Metadata key | Rule |
|---|---|---|
| `mode` | `queue_mode` | required, a known queue mode (below) |
| `startingLives` | `starting_lives` | required, a whole number of 1 or more |
| `hunterLives` | `manhunt_hunter_lives` | required, a whole number of 1 or more |
| `pvpStartAnte` | `pvp_start_round` | required, a whole number of 1 or more |
| `deathOnRoundLoss` | none | always true (not a lobby key) |
| `clocks` | `ruleset` | the ruleset's clock row (below); a missing or unknown ruleset is refused `bad_rules` at the start |

- `queue_mode` gives the mode: `pvp_nemesis` and `pvp_experimental` give `nemesis`,
  `pvp_manhunt` gives `manhunt`, `pvp_teams` gives `teams`, `pvp_royale` and
  `pvp_smallworld` give `royale`. Anything else is `bad_rules` (`queue_mode`) and gives
  no team picks. Small World differs only in client content and plays the Royale rules.
- A refusal names its key: the `ACTION_REJECTED` of `mpapi_start_game` carries
  `reason: "bad_rules"` and `key`, and the metadata guard's error carries the same pair.
  A `pvp.*` request that freezes the rules and finds them bad is answered
  `{ok:false, reason:"bad_rules", key}` (the answer carries the optional `key`). The same
  check runs at the tick's freeze; a game whose rules do not validate there cannot be
  refereed: it ends `abandoned` and the server log gets one line,
  `run <runId> is unrefereeable: bad_rules <key>`.
- A league ruleset (`ruleset_mp_majorleague`, `ruleset_mp_minorleague`) forces its timers
  (section 8), so its lobby needs neither timer key.
- `clocks` is `{ante, pvp, personal}`: `ante` is `"none"`, `"bank"` or `"personal"`; `pvp`
  is `null` or `{baseMs, handMs}`; `personal` is `null` or `{kind:"pressure", baseMs,
  timedRate, previewCostMs}` or `{kind:"speedlatro", baseMs, pvpMs, graceMs, timedRate, previewCostMs}`.
  A ruleset with no clock row is refused `bad_rules` when the game starts (and a seed
  restart), so a started game always has one.
- The timer rules `timerBaseMs`, `timerIncrementMs`, `timerForgiveness` and `skipTimeRule`
  are frozen at the same time but are not projected: clients are told the deadline, not the
  rule (section 8).

### `pvp.round`

```json
{"runId":"r1","roundId":3,"phase":"shop|playing|resolved",
 "players":{"<id>":{"score":"0","handsLeft":4,"highestScore":"1200","ante":2,"furthestBlind":5,"timerLosses":0,"handsSpent":false,"pvpLeftMs":null,"canTime":false}},
 "lastResult":{"roundId":2,"losers":["<id>"]},
 "deadline":null}
```

- `deadline` is `null` or the timer object of section 8.
- Every round fact except `timerLosses` and `handsSpent` is `null` while it is unknown: `score`, `handsLeft`, `highestScore`, `ante`, `furthestBlind`. Nothing is defaulted.
- `handsSpent` is a boolean, always sent. The server sets it when it ends a player's hands
  for the round (the hand-timer backstop); `handsLeft` stays as reported. A player is out of hands when `handsSpent` or `handsLeft === 0`. Opening the next
  round clears it. It is not hidden by the mask.
- `pvpLeftMs` is the player's PvP hand-timer allowance in ms, or `null` on a ruleset with no
  PvP clock. It is a time, so the mask does not hide it.
- `score` and `highestScore` are `null` for a masked viewer (section 4a). `canTime` (whether the player's PvP timer could be started on them) is sent only to an unmasked viewer, and `pvp.round` is pushed whenever it changes.
- Idle: `{"runId":null,"roundId":0,"phase":"shop","players":{},"lastResult":null,"deadline":null}`

### `pvp.lives`

```json
{"runId":"r1",
 "players":{"<id>":{"lives":3,"eliminated":false,"forfeited":false,"left":false,
                    "events":[{"delta":-1,"key":"2:Big"}]}},
 "teamLives":{"A":5,"B":6},
 "pending":[{"playerId":"<id>","blindKey":"2:Big","waitsOn":["<id>"]}]}
```

- Idle: `{"runId":null,"players":{},"teamLives":null,"pending":[]}`
- `events` only grows within a run. There is one entry per change of that player's
  lives. A loss has `key` set to the blind key, or to `"pvp:<roundId>"` for a PvP loss.
  A gain (the Manhunt voucher) has `key: null`. Section 5 uses this as the applied index.
- In Teams, a pool loss adds one event to every member of that team, and each member's
  `lives` equals the pool in `teamLives`. In other modes `teamLives` is `null`.
- A Manhunt voucher gain (R42) is the event `{"delta":1,"key":null}` on every Hunter who
  is in the run with lives left. A Hunter who is out is not brought back.
- `pending` lists dead players whose result waits. It is not a deferred life loss.
  - One starts when a player loses their last life on a blind that is not the PvP blind
    (R11, R21, R32, R45, R53).
  - `waitsOn` lists the players whose result on the same blind decides it.
  - A beaten report settles it. A failure settles it too, as a win for the other side if
    they still have lives, or as a draw otherwise.
  - If the awaited player leaves, the dead player wins.
  - In a game of 3 or more players several can be open at once, and only the deaths that
    still wait are shown.

### `pvp.targets`

```json
{"runId":"r1","opponents":{"<id>":"<id>|null"},"cardTargets":{"<id>":"<id>|null"},
 "teamScores":{"A":"1500","B":"900"},"safe":{"<id>":true},"pairingAnte":2}
```

- Idle: `{"runId":null,"opponents":{},"cardTargets":{},"teamScores":null,"safe":{},"pairingAnte":null}`
- It is derived from the state on every read. Nothing is stored.
- `opponents` holds the duel opponent, the Nemesis partner (`null` for a bye), the Royale
  live target (R26), or the Manhunt target (R44: a Hunter's target is the Runner, the
  Runner's target is the best-scoring Hunter in the run, and a tie goes to the smaller
  id).
- `safe` is Royale only, and `{}` elsewhere. It says for each living player whether the
  cut would spare them right now.
- `pairingAnte` is Nemesis only, and `null` elsewhere. It is the ante the stored pairing
  was made for.
- `cardTargets` and `teamScores` are Teams only, and `{}` and `null` elsewhere.
  `cardTargets` holds one stored random opposing member per player (R51). `teamScores`
  is the sum of each team's scores in the current round (R54).

### `pvp.skips`

```
{ "runId": string | null,
  "players": { "<userId>": { "skips": int | null, "anteBankMs": int } } }
```

Every player of the run is listed. `skips` is 0 when the server opens the run (a new run has no skips) and
the last `pvp.skip` total after that. `anteBankMs` is the player's Ante bank now (section 8a); while
their own server-counted deadline runs it is the bank as frozen when the deadline last
changed. Idle: `{runId: null, players: {}}`.

### `pvp.nemesis` (per viewer)

```
{ "runId": string | null,
  "byAnte": { "<ante>": { "each": [userId], "one": userId | null } } | null }
```

The viewer's own targets, frozen per ante: `each` is who the viewer's effects hit and
`one` the viewer's single opponent. A row is frozen once its pairing is known and
never changes; an ante the server never saw has no row (unknown). `byAnte` is `null`
for a user who is not in the run. Other players' rows are never sent. Idle:
`{runId: null, byAnte: null}`.

### `pvp.effects` (per viewer)

```
{ "runId": string | null,
  "me": { "incoming": [{ "from": userId, "n": int, "kind": string, "amount": int }] } | null }
```

The effects aimed at the viewer; `n` is the effect's place in that list, from 1. `me` is
`null` for a user who is not in the run. Idle: `{runId: null, me: null}`.

### `pvp.opponent`

```
{ "runId": string | null,
  "players": { "<userId>": { "sells": { "<ante>": int }, "slots": [Slot], "closed": bool } } }
```

Lobby-wide. A `Slot` is `{ante, spent}`, `{ante, skipped:true}` or
`{ante, refused: reason}` (the payload it was refused with is never sent). `closed` is
true once the player is out of the run. Idle: `{runId: null, players: {}}`.

### `pvp.traps`

```
{ "runId": string | null, "trapSeq": int,
  "traps": [{ "id": int, "key": string, "owner": userId, "holder": userId,
              "state": "live" | "lost" | { "fired": data } }] }
```

Every trap in play, lobby-wide. Idle: `{runId: null, trapSeq: 0, traps: []}`.

`pvp.nemesis` and `pvp.effects` are sent per viewer: each seated player gets the value
for them, in their snapshot and in every STATE. A change that moves only one viewer's
value names the key to that viewer only; every seated player still gets the same `rev`.
The server also keeps `server` facts (the last seen ante) that
are never published. All of these records are in the checkpoint (schema 2) and come
back after a restart.

### `pvp.clocks`

Present only when `rules.clocks.personal` is set (the key is absent otherwise).

```json
{"<id>":{"ms":300000,"running":true,"rate":1,"n":2,"spent":false}}
```

- One entry for every starter, kept after they leave (a player who left stops their
  clock). `ms` is the time left as of the clock's last `n`; a
  running clock counts down by `rate` (1, or the timed rate) from then. `spent` is a
  boolean (Speedlatro: the clock ran out this round).
- `since` and `graceUntil` are the server's and never sent.
- A STATE is pushed only when an `n` changes, so a running clock sends nothing per tick.
  A SNAPSHOT shows `ms` live (`ms` minus the elapsed time times `rate`, not below 0).

### `pvp.teams`

```json
{"runId":"r1","teams":{"<id>":"A|B|RUNNER|HUNTER"}}
```

- Idle (no picks): `{"runId":null,"teams":{}}`
- Before a run, and after it ends, `runId` is `null` and `teams` holds the lobby's picks
  that the current mode offers. A player picks for themself only. A pick is dropped when
  the player leaves.
- During a run it holds the settled roster (R35, R46).
- A team pending (Manhunt R45, Teams R53) reuses the `pending` shape: `playerId` is the
  player who died and `waitsOn` is the other side's members who are in the run. One of
  them beating that blind wins it for their side. All failing, out or gone is a draw.

### `pvp.votes`

```json
{"runId":"r1","draw":["<id>"],"seed":["<id>"]}
```

- Idle: `{"runId":null,"draw":[],"seed":[]}`

### `pvp.result`

Set once per game and frozen after that.

```json
{"runId":"r1","kind":"win|draw","winnerId":"<id>|null","winnerTeam":"<team>|null",
 "places":[{"playerId":"<id>","place":1}]}
```

- Idle: `{"runId":null,"kind":null,"winnerId":null,"winnerTeam":null,"places":[]}`
- In Manhunt and Teams, `winnerTeam` is `"A"`, `"B"`, `"RUNNER"` or `"HUNTER"` and
  `winnerId` is `null`. Every member of the winning team is place 1 and everyone else
  is place 2. A draw is all place 1.

### 4a. The score mask

A player does not see an opponent's score until they have played a hand themselves. The
rule, for a viewer V:

- V is masked while the round `phase` is `playing`, V has no hand stamped for this
  `roundId` (`facts.handRound`), and V is not out of hands. A player who has not started
  the round (unknown hands) is masked. A viewer with no seat in the round is
  masked while it plays.
- `pvp.blind_start` sets V's hand count but plays no hand, so it does not stamp V (section 3).
- Resolving the round (`phase` leaves `playing`) unmasks everyone.

What a masked viewer is sent, in a STATE, in the join SNAPSHOT and in the `snapshot`
request:

- `pvp.round` with a `null` `score` and `highestScore` and no `canTime` for any player, their own included
  (the client knows its own score).
- `pvp.targets` with `teamScores: null`, and `opponents` and `safe` computed as if every
  score were zero, so the order falls to each mode's tie-break by id and never shows the
  ranking. The mode tie-breaks never read the score.
- Every other key is the same for everyone.

Per-viewer STATE:

- Each player still gets exactly one STATE per change. The players are grouped by what they
  may see, and each group's payload is built once (usually two payloads).
- `rev` and the list of changed keys come from the unmasked state, but a masked viewer is
  not sent `pvp.round` or `pvp.targets` when the masked value did not change: the key
  arriving alone would show that a score or the ranking moved. Every other changed key is
  sent as usual.
- That can leave a masked viewer with a STATE whose `changed` is empty (only a hidden score
  moved). It is still sent so that `rev` stays continuous for them.
- A viewer whose mask flipped in this change (they just played a hand) is always sent
  `pvp.round` and `pvp.targets`, so they unmask even when those keys did not change.

What the mask does not hide: `deadline.against` names who was timed, and a player who has
played a hand and so sees the scores can read the timer rule (`not_ahead`) as before. A
masked player cannot start a timer at all (section 8), so a refusal tells them nothing. A STATE with an empty `changed` still tells a masked viewer that something moved, though
not what. A spectator
or a second account is out of scope.

## 5. Exactly-once effects

A client must not pay or charge the same life change twice, even across a reconnect. The
applied index does this. The server keeps `pvp.lives.players[<id>].events` append-only
within a run, and never rewrites or reorders it, so the count of events is a stable
index.

Lives (client side):

- The client keeps, per player id, how many events of the current `runId` it has applied.
  It saves that count with the run.
- On every STATE or SNAPSHOT it walks `pvp.lives.players[<me>].events` past the applied
  count. For each new event it applies the effects, then writes the new count.
- The effects of an event are:
  - move the lives display by `delta`;
  - the comeback gold bonus, only for a loss (`delta < 0`), only when the gold-on-life-loss
    rule is on, and only when the player's lives before the event were not 0. A gain pays
    nothing;
  - zero the blind's dollars, only for a loss, only when the no-gold-on-round-loss rule is
    on, and only when the event's `key` is the blind being played now. A catch-up in a
    later blind skips it.
- A different `runId` resets the count to 0.
- Effects apply only after the run save for that `runId` has loaded. A rejoin SNAPSHOT
  that arrives earlier is kept as the latest state and applied once the save loads.

Result:

- `pvp.result` drives the match record and the roster result. The client keeps a record
  per `runId`, so these happen once.

Cosmetics (banners, sounds, the opponent-ready marker) come from comparing the previous
and the next state. They fire at most once per change seen, and a missed one is
acceptable.

## 6. Server triggers

Some changes need no request. These are the server's own triggers:

| Trigger | Effect |
|---|---|
| A player disconnects (their seat enters grace) | Their Ready drops, so a round never starts against a player who is not there. A server-counted deadline that times them is paused until they are back (section 8). Nothing else happens until grace ends. |
| A seat is removed (grace expiry, catch-up limit, leave, kick) | Their Ready drops, and the round starts if they were the one the others waited on. The seat is recorded as `left`. The tick treats it as a forfeit (R20, R33, R43, R52), settles pending deaths that wait on that player, and recomputes targets. |
| The server restarts and resumes the match | Every Ready is void (`gameAfterResume` clears `ready`, `firstReady`, `blindKeys` and `order`) but `readied` stays, so a Pressure clock stays held across a resume. The game, the round count and the last start stay. The downtime (resume time minus checkpoint time, never negative) is added to a running deadline's `endsAt`, to every personal clock's `since` and to a numeric `graceUntil`, so the PvP timer and the personal clocks show what they showed when the server stopped; a paused deadline is copied unchanged. An Ante deadline is also marked `resumed`: the restart voided its starter's Ready, not the starter, so the missing Ready does not end the timer until the starter is Ready again (that clears the mark; after it, an unready starter ends the timer as usual, and a starter who leaves still does). The mark holds the id of the last round start; a round started since ends the timer, and a marked timer stands still while its starter is away (every seat is, after a restart), so the first player back is not timed against a starter who has not returned. A run-out restart drops the mark. A checkpoint written by another build (a different or missing `schema`; the current one is 3) is deleted and the match is not resumed, with no run record. |
| The host changes | Nothing. |
| `mpapi_abandon_game` | A forfeit by the requester (section 3). |
| The PvP tick | See below. |

One tick step does these things, in this order:

1. If the result is already set, finish the game (section 7) and do nothing else.
2. Before the run began (no replay event yet), decide nothing on rules: a leave or
   forfeit ends the game as section 7 says. Once it began, freeze `pvp.rules` (if the
   request shell has not), seat every starter with the starting lives, and let the
   mode's `init` settle the roster and lives (R1, R35, R36, R46, R47).
3. Read the new facts: forfeits, ante-timer run-outs, failed rounds (the guarded life,
   R2, R4) and vouchers.
4. Mark seats that left the lobby, and run the mode's forfeit hook.
5. Run the timer step (section 8).
6. Resolve the round once every living player has no hands left (R10, R16, R22, R29, R37,
   R48). This sets the phase to `resolved` and writes `lastResult`. The tick then takes
   the losers' lives.
7. If a new ante was reached between rounds, run the mode's ante hook (R27, R28, R51).
8. If a new `pvp.ready` start arrived, open the next round.
9. Settle pending deaths.
10. Decide the votes (R13). A passed draw vote writes a draw result. A passed seed vote
    restarts the game on a new seed.
11. Check the winner, unless a pending death is open. Fill in standard places if the mode
    gave none.
12. If a result is set, the game finishes (section 7).

The same step also gives a returning round start to players who were put out: if the tick
put someone out of the run, the others may have been waiting only on their Ready, and the
round starts now if all are Ready (R31).

## 7. Finishing

- A started player who is not attached when any announced game ends (away, left or already
  removed, so they never get GAME_ENDED) is told afterwards: the server keeps the same
  `{ runId, status }` for them in `game.endedAway`, and the snapshot they get next (after
  they join the lobby again) carries it as `game.lastEnded` (`null` for everyone else, and
  for a game that was not announced, such as a restart). The next game start clears it, and
  only the player's own end is ever recorded. It is not cleared when delivered: every
  snapshot repeats it until the next game starts, so a client dedupes by `runId`. A player
  who joins a different lobby is not told. Example:
  `"game": { ..., "lastEnded": { "runId": "r1", "status": "dodged" } }`.
- A leave or `pvp.forfeit` before the run began (Setup or Draft, rules not frozen): in a
  2-player game it ends at once. The stayer wins, stored `agreed` for a casual game.
  In a ranked game the game is stored `dodged` with no placements: nobody is rated, and
  a dodge record is written for the leaver (the penalty is a follow-up). If both
  players of a 2-player game are gone before the run began, the game is stored
  `abandoned` with no placements and nobody is rated; in a ranked game each of the two
  gets a dodge record. In a game of 3 or more the leaver is just out and the game goes on,
  unless every started player is gone before the run began: then the game is stored
  `abandoned` with no placements and nobody is rated. In a ranked lobby of 3 or more
  (only a hand-made one) a player who times out keeps their forfeit, and a player who
  leaves on purpose before the freeze gets no record; no dodge is recorded.
  Being away through the Draft counts the same way in a ranked game of two, by one
  rule: a seat that was away when the race began (`awaySince` at or before
  `raceStartedAt`, the first replay event) is a leaver, so the game is a dodge and not a
  forfeit. The race cannot begin before the Draft result exists, so a seat away through the Draft is
  away at the stamp. A seat that drops after the race start is a forfeit. A seat that was
  away and came back before the race start is not a leaver. `pvpTick` is the only place
  that decides this: when the grace of such a seat runs out, the lobby tick leaves the seat
  in place and `pvpTick` stores the dodge in the same pass, so there is exactly one record.
  The window belongs to the first run of a game only: a restarted run (a seed vote or a
  restart; the server marks the started game `restarted`, a flag that is not in the
  snapshot clients get) has none, and a seat that drops
  across a restart is a rated forfeit as before.
- If every player forfeited or left after the freeze (none died), a casual or private
  game ends in the mode's draw, stored `agreed`. A ranked game is stored `abandoned`
  with no placements and nobody is rated, so two players cannot trade wins by
  forfeiting together. A ranked all-forfeit sends NO `pvp.result` STATE (the referee's
  draw is discarded), only GAME_ENDED with status `abandoned` and `placements: []`,
  the same ending as the all-gone case before the run began.
- A draw (every rated player shares the best place) is no one's win and no one's
  loss in the rating: it keeps its rating delta and counts as a game played, and
  neither the win nor the loss count moves. `[1,1,2]` is no draw: both first places
  win. A single placement is no draw either: a lone rated player keeps the win.

- When a result is set, the server sends one STATE that carries `pvp.result` and then
  finishes the game in the same step. So clients see the result before the game-ended
  event.
- The STATE that carries `pvp.result` is the last one the game sends: finishing resets the game to its idle values without announcing that reset. A client's mirror keeps the final `pvp.*` values (the result, the lives, the round) after a finish, by design: the client applies the result from them once its run has loaded. The next game's start announces the new values. An abandoned game is not decided by the referee and does announce the idle values.
- The game is stored with the status `agreed` and the placements from the result. Client
  reports are not consulted.
- Placements:
  - the winner, or every member of the winning team, is place 1, with performance 1 only
    when exactly one player holds place 1, otherwise 0;
  - everyone else has the place the result gives them (place 2 in the standard case, and
    the explicit places of R32 in a game of 3 or more players);
  - a draw puts everyone in place 1 with performance 0, and the rating counts it as
    neither a win nor a loss (see the draw rule above);
  - the metric of a placement is the player's best PvP score of the game, a whole number
    capped at 1e15 (R15). A score written with commas, which is past a double, is the cap.
- The game-result check (`settle`) does not end a refereed game from reports or from a
  pending hold. Only the hard cap is left: if every player is gone, or the game is down
  to one player for the result timeout, the run is stored as `abandoned` and is not
  rated.
- A result reported late by a player who had already left is handled as for any game.
- A contest ends a refereed game of two. In the same loop step in which a player
  contests, the tick stops refereeing and finishes the game: it is stored as `contested`
  with no placements, and the game-ended event goes out once. The tick decides nothing
  for a contested game of two: no life is lost and no result is written, even when a
  deadline runs out in that same step. A moderator decides the run. In a game that started
  with more than two players only the contester leaves: the others play on, the referee
  decides their places, and the run is stored as `contested` when it ends.

## 8. Timers

One deadline per game. It says who is being timed and, for one kind of clock, how long
is left.

### The clocks

The ruleset's clock row (`pvp.rules.clocks`, section 4) says which clocks a game has. The
server counts every one of them and no client counts or reports a run-out.

| Clock | `clocks` field | Counted by |
|---|---|---|
| Ante timer with a bank | `ante: "bank"` | the deadline, on the server's wall clock (started by an opponent) |
| Ante timer, personal | `ante: "personal"` | the personal clocks below; the deadline only marks who is timed (`remainingMs` null) |
| PvP hand timer | `pvp: {baseMs, handMs}` | the deadline, on the server's wall clock, with the allowances in `pvp.round` (`pvpLeftMs`) |
| Personal clock (Pressure, Speedlatro) | `personal` | `facts.clocks`, one per seated player, stepped by the tick |

`ante: "none"` (the traditional ruleset) has no Ante clock: `pvp.timer_start` kind `ante`
answers `no_timer`.

### The deadline in match state

`pvp.round.deadline` is `null` or:

```json
{"kind":"ante","by":"<starter id>","against":["<id>"],"remainingMs":150000,"n":3}
```

While a server-counted deadline is paused it has one more key, `"paused":true`
(see below).

- `kind` is `"ante"` or `"pvp"`. `by` is the starter. `against` is the list of players
  being timed now, sorted.
- `remainingMs` is a number for a server-counted deadline. It is `null` for a deadline
  that only marks who is timed (`ante: "personal"`).
- `n` goes up by one on every start and every restart. A client keeps its local countdown while
  `n` stays the same and `paused` does not appear or disappear; it re-bases its countdown
  when `n` changes or when `paused` appears or disappears (a pause and a resume keep `n`).
- In a STATE, `remainingMs` is the value frozen when `n` last changed, or when the
  deadline went on after a pause. A running deadline therefore changes no key, and no
  STATE is pushed per loop step.
- In a SNAPSHOT (join or rejoin), `remainingMs` is live: the time left on the server's
  clock, not below 0. A client always resets its countdown from a SNAPSHOT. A timed
  player's reconnect resumes a paused clock with the time left that was stored.
- A server-counted deadline is paused while any player in `against` is away (in their
  grace window). A paused deadline has `"paused":true`, and `remainingMs` is the time
  left, standing still, in a STATE and in a SNAPSHOT. The key is absent otherwise. When no
  timed player is away any more the deadline goes on with that time left and `paused`
  goes away. The starter being away does not pause it: the starter's own disconnect drops
  their Ready, so the deadline ends (step 2 under "What the tick does with the
  deadline").
- A server-counted deadline also stands still while any player in `against` is animating
  (`pvp.animating`), and goes on with the same time left when none is. It looks the same
  as the away pause (`"paused":true`). The starter animating does not pause it. A PvP
  hand timer does this; an Ante deadline never does. A deadline with no server end (a
  personal-clock Ante) never pauses.
- The server does not limit how long one `animating: true` stretch lasts. A timed player's
  client can hold a paused deadline for as long as it reports animating, the same as the
  old client-counted timer (whose animation budget never ran down).
- The Pressure personal clock stops while its owner is animating. Speedlatro does not.
- The animating set is server-only. It is cleared when the round closes, when a player is
  away, leaves or is out of the run, and on a new run, so the client sends
  `pvp.animating` again after a reconnect or a round close.
- A deadline the starter pauses (`pvp.timer_pause`) is `null`. The starter's client keeps
  the time it last showed as its bank.
- A game decided in a tick shows `null` in the STATE that carries the result.

### Starting and pausing

`pvp.timer_start` and `pvp.timer_pause` only record a fact. The tick opens or drops the
deadline with its clock. The first press wins: a start while a deadline runs is accepted
and changes nothing.

Who a start would time:

- Ante. The sender must be Ready (`not_ready`). The timed players are the required
  players who are not Ready, are still in the run, and are not on the sender's own side.
  A side that is not set never matches, so it times nobody extra. If that leaves nobody,
  the answer is `nobody_to_time`.
- PvP. The sender must be in the open round (`not_playing`, and `round_over` for a wrong
  `roundId`). The timed player is exactly the sender's target in `pvp.targets.opponents`
  (`no_opponent` if there is none). That player must be in the run, have hands left, and
  be behind the sender. A score tie counts as behind only for the player who pressed
  Ready first. If the target is not behind, or the sender has not played a hand this round,
  the answer is `not_ahead` (section 4a). This does not depend on the hand timer being in the rules.

### 8a. The skip time and the Ante bank

The server derives each player's Ante bank from facts the client reports (`pvp.skip`,
`pvp.timer_spend`) and the frozen rules:

- `lead(p)`: under `skipTimeRule` `"lead"`, `max(skipsSincePvp(p) - skipsSincePvp(q), 0)` where
  `q` is the player `p` faced at the last reset (the live opponent before any reset). Under
  `"own"`, `skipsSincePvp(p)`. No facing player, or either side unknown, is 0.
- `bank(p) = clamp(timerBaseMs + timerIncrementMs * lead(p) - spentMs(p), 10 s, 60 min)`.
  A lobby with no `timerIncrementMs` (null) pays no skip time.
- `spentMs` grows by a `pvp.timer_spend` and by the time a deadline the player started ran
  when it is paused, dropped, or runs out (time while a timed player is away is not
  counted). A spend never takes the bank below 10 seconds. A run-out restart is from the
  base: `spentMs` is set to `timerIncrementMs * lead`.
- Reset: when a PvP round opens and when it closes, every player's `spentMs` is 0, the
  skip baseline is their skips so far, and the faced player is pinned.
- Skips made while a timer runs count.

### What the tick does with the deadline

The timer step runs after the facts are read and before the round resolves, so a run-out
is in the lives before places and the winner are decided. In order:

1. Open. A start fact with no deadline running opens one. `n` goes up by one. A bank
   sets the end time to now plus the bank. No bank means the client counts.
2. Drop. A deadline ends on its own when the starter pauses, the game is decided, the
   starter left, forfeited or is out of lives, an Ante starter is no longer Ready (a
   round start clears Ready, so this also ends it when the PvP round begins), or a PvP
   round is no longer taking hands.
3. Refresh. `against` is worked out again from the state on every tick with the same rule
   the request used. A seat that is away but inside its grace window stays timed; once
   its grace runs out the seat is removed and no longer timed. A deadline with nobody
   left to time is dropped.
4. Pause. A server-counted deadline with a timed player who is away stores the time it
   has left and stands still: it cannot run out. When no timed player is away any more
   its end is now plus the stored time left. It is one clock, so one away player pauses
   it for every timed player. A timed player who is animating pauses it the same way
   (PvP only; an Ante deadline never).
5. Expire. A server-counted deadline that is not paused and whose end has passed gives
   every timed player one run-out, all in one moment (so two players on their last life
   draw). Then, if anyone timed is
   still in the run, the deadline restarts against those players: the end time is now plus
   the rule's base and `n` goes up by one. After a clock jump the base counts from now, so
   one expiry fires, not one per missed period.
6. Personal clocks. When `rules.clocks.personal` is set, the tick steps every personal
   clock after the next round opens and before pending deaths settle (see "Personal
   clocks" below). Each run-out costs a life as an Ante run-out does.

Start and pause facts, hand credits, `preview_charge` facts and blind facts are read once
and then dropped from the log in the same tick (a blind result lives on in the blinds
memo).

### Personal clocks

On a ruleset with a personal clock (`rules.clocks.personal`), the first tick of a game
seeds one clock per seated player at the base (not running, `n` 1) and replaces any entry
of an earlier run. Every tick after the next round opens, `clocksStep` (`clocks.ts`) reads
each holder's inputs from the state (in the run, ready, readied, away, round open, round
closed this tick, timed, own blind start, hands done, own and rival score, rival skips,
team mode, unapplied `preview_charge` facts) and returns the new clocks and the run-outs.

- Pressure runs between rounds while the player is not Ready (a player who has been Ready
  runs only while timed), at the timed rate while an Ante deadline times them. An
  opponent's skips credit `timerIncrementMs` each. A Score Preview costs
  `previewCostMs` once per `preview_charge` fact (free at or below 10 s). A run-out
  refills the clock to the base.
- Speedlatro runs outside PvP and, in a PvP round, from the player's own blind start
  after the grace while the player is not ahead; a run-out leaves it `spent` until the
  round closes.
- Every round close resets the clock to the base.
- Each run-out costs a life through the One run-out step below, subject to
  `timerForgiveness`.

### One run-out

Every run-out (an Ante expiry or a personal clock reaching 0) uses the same step, one batch
per tick sharing one moment:

- If the player still has forgiven run-outs left (`forgiven` below `timerForgiveness`),
  one is used up and nothing else happens. The forgiveness count lives on the server only.
  The client reports every run-out.
- Otherwise the blind is recorded as failed (R12), the player loses one life, unguarded
  (R3), and in every mode except the duel the player is out of hands (R34). The failed
  blind is recorded here, not by the request, so a forgiven run-out fails nothing.

### The blind of a server-made run-out

A run-out the server makes is filed on the blind the client would have filed it on: the
player's own next blind.

- Take the ante of the player's last `pvp.progress` report (a Manhunt voucher can lower
  it, so this is not the highest ante).
- The key is the first of Small and Big of that ante that the player has not reported
  with `pvp.blind`. If both were reported, it is that ante's Boss.
- Only the player's own `pvp.blind` reports count, whatever the merge did with them. The
  failures a run-out files do not count, so run-outs on one blind all land on it.
- Known race: right after a Boss, before the player's progress report raises their ante,
  the key is that ante's Boss again, one ante behind the real next blind.

### Rules frozen at the start

| Rule | Lobby metadata | Default | Bounds |
|---|---|---|---|
| `timerBaseMs` | `timer_base_seconds`, in seconds | required (180 s forced on `majorleague`, 210 s on `minorleague`) | 10 seconds to 60 minutes |
| `timerIncrementMs` | `timer_increment_seconds`, in seconds | optional: absent or `null` is `null` (no skip time); a non-number is `bad_rules` | 0 or more |
| `skipTimeRule` | `ruleset` | `"lead"`; `"own"` for `ruleset_mp_majorleague` | |
| `timerForgiveness` | `timer_forgiveness` | required (0 forced on `majorleague`, 1 on `minorleague`) | 0 to 9, whole number |

The host publishes the raw values with no multiplier.

### Ranked lobbies keep their queue's rules

A ranked PvP lobby (mod `MultiplayerPvP`, ranked mode `pvp_ranked_<ruleset>`) starts on
the rules of the queue the players joined, and a host write of a pinned key with a
different value is refused `bad_rules` naming the key, before and after the freeze (the
rest of the patch is kept; the same value is accepted). The five queues are `balanced`,
`expanded`, `vanilla`, `majorleague` and `smallworld`. Each pins `ruleset`
(`ruleset_mp_<name>`), `queue_mode` `pvp_nemesis`, `starting_lives` 4, `pvp_start_round` 2,
`manhunt_hunter_lives` 7 (the client's lobby default) and `timer_increment_seconds` 60,
plus `timer_base_seconds` 150 and `timer_forgiveness` 0 unless the ruleset forces its
timers. Deck, stake and the like stay free. A ranked PvP mode with no pin is refused
where the lobby is made (the matchmaker match, the dev `lobby_create` rpc, the match
init). Casual lobbies and other mods are not pinned.

## 9. Relayed client messages

Most PvP traffic is no longer relayed between players, because the server referees the
game. The relay (actions sent to other players) allows only these 9 `pvp_*` keys. The
list is exact and sorted.

| Key |
|---|
| `pvp_end_game_stats_requested` |
| `pvp_get_end_game_jokers` |
| `pvp_get_nemesis_deck` |
| `pvp_location` |
| `pvp_log_event` |
| `pvp_nemesis_end_game_stats` |
| `pvp_player_result` |
| `pvp_receive_end_game_jokers` |
| `pvp_receive_nemesis_deck` |

- Every other key that starts with `pvp_` is dropped from every sender, host or not, and
  reaches nobody. The refusal kind is `not_relayed`. This covers the old host referee
  outputs (start, round state, lives, targets, results), the old inputs (ready, hand,
  fail, vote, forfeit), and any key a modified client makes up. A modified client has
  nothing to forge in the game itself.
- The nine relayed keys are display data between players and the server does not check
  them. In particular `pvp_player_result` carries the sender's own claimed highest score
  and jokers for the end screen and roster, so a modified client can show a false value
  there. Ratings, places and the placements metric never read it: they come from the
  match state.
- The list is the whole rule. A new client action that must be relayed has to be added
  to it. A test checks the list against the keys the PvP client registers, and the keys
  are also kept in a JSON fixture.
- The Speedrunning mod is still refereed by its host. A few of its match-deciding keys
  are ruled by sender: `spdrn_match_timeout` and `spdrn_match_draw` and
  `spdrn_seed_change_apply` only from the host of record, `spdrn_player_result` only for
  the sender's own id, and `spdrn_player_won` for the sender's own id or from the host.

### Replay logs tell the others only who and when

The `mpapi_log_event` and `mpapi_log_events` actions (every mod uses them) store a
player's replay events. A hand result in them carries the score, so the others do not get
the event:

- The copy sent to the other players is `{playerId, t}`, and `{playerId, t, count}` for a
  batch (the last event's `t`). It never has `opcode` or `args`. Clients only track how far
  each stream has got.
- A spectator still gets every whole event.
- A player who rejoins gets a REPLAY_TAIL of the others' logs with each event as `{t}`
  only. Their own events are in `run_active`, in full.
- The PvP client also broadcasts each replay line as the peer action `pvp_log_event`
  `{t, opcode, args}`. The relay sends the other players `{t, opcode}` (no `args`, always,
  not only while masked) and the sender its own copy whole. `spdrn_log_event` is left
  whole: Speedrun has no score mask, by design.

## 10. Fault cases

The list of cases below comes from Fenil's PR #599.

1. The same fact is sent twice: the `reqId` dedupe gives one effect.
2. A stale hand arrives under a new `reqId` after a reconnect: `stale_hand`.
3. Facts arrive out of order:
   - a fail after the result gets `round_over`, and the result is unchanged;
   - a `pvp.blind` that arrives before the death needs no ordering, because the tick
     decides from both.
4. The host leaves mid-round: nothing changes.
5. A player reconnects in the shop, while playing, after a round, or after the result: the
   SNAPSHOT plus the applied index gives the same lives and gold. There is no double loss,
   and the wrong blind is not zeroed.
6. A takeover of a seat with 0 lives cannot happen: a player with no lives is out of the
   run, and a gain never revives.
7. A rev gap during a burst: `snapshot` catches up with no double apply.
8. A late `pvp.blind` after a forfeit: `eliminated`.
9. Ante-timer run-outs: two in one blind cost two lives (R3). One run-out with
   `deathOnRoundLoss` on costs exactly one life. A run-out followed by a real round
   failure in the same blind costs two (R3 and R4).
10. One early `mpapi_report_result` in a live ranked duel: refused with `server_referee`,
    and no hard-cap abandon follows.

## Appendix: Rules

These are the game rules the server applies. Each rule has a number. Code comments cite
them as R1 to R55.

### Every mode (shared)

- R1. At the start every player gets the starting lives, score 0, the round's hands, no
  Ready, and no life guard spent.
- R2. A guarded life loss (a failed round, or a lost PvP round) costs a player at most one
  life per blind. A PvP loss is blocked only if a life was already charged on that blind,
  so two PvP losses on the same Boss with nothing between cost two. The guard of the PvP
  blind is re-armed when a new round opens on it.
- R3. An Ante-timer run-out costs a life every time. It is not guarded and does not spend
  the guard.
- R4. A failed blind costs a guarded life only when `deathOnRoundLoss` is on (default on),
  and only when the client says the round was lost. A failure recorded alone costs
  nothing.
- R5. Lives never go below 0. A player at 0 loses nothing more.
- R6. The server's record is the only record of lives. Clients never report lives.
- R7. A PvP-timer run-out costs one hand, not a life.
- R8. A round starts when at least two required players remain and every one of them is
  Ready. Required players are those who started, are still seated, and are not out of the
  run. An unready, a disconnect, a leave, or being put out drops that player's Ready.
  There is no separate ready check.
- R9. A round start resets every score to 0, resets each player's round facts to unknown (their hands arrive with `pvp.blind_start`), and opens a new round id. A round that was still playing closes first with
  no losers.
- R10. A round resolves once. After it resolves, later hands are refused as `not_playing`.
- R11. Pending death: a player who loses their last life on a blind that is not the PvP
  blind does not end the match at once. The other side must face the same blind. If they
  beat it, they win. If they fail it, they win if they still have lives, and it is a draw
  if the failure cost their last life. If they leave before beating it, the dead player
  wins.
- R12. A blind failure is final. Beating the blind later does not undo it.
- R13. A draw vote or a seed vote passes when every player who is still in the run and
  still seated has said yes. A draw vote ends the game as a draw. A seed vote restarts the
  game on a new seed with the same deck and stake and no new draft.
- R14. The result is set once, frozen, and sent in one STATE before the game-ended event.
- R15. The metric of each placement is the player's best PvP score of the game, a whole
  number capped at 1e15. A score with commas is the cap. A player who never reported a
  score has a placement with no metric (unknown is not 0, so it never ties a real 0).

### One against one (a game that started with exactly two players)

- R16. The round ends when the trailing player has no hands left, or when both have none.
- R17. The higher score wins the round. An exact tie costs nobody a life.
- R18. The loser loses one guarded life. If a player reaches 0, the one with more lives
  wins the match.
- R19. The first player is whoever pressed Ready first. They win a score tie for the PvP
  timer.
- R20. A forfeit or a leave puts that player out, and the remaining player wins.
- R21. In a two-player game, a last life lost on a non-PvP blind is a pending death. A
  beaten report from the opponent settles it at once. A failure waits for the opponent's
  life count.

### Royale and Small World (more than two players, no pairing)

- R22. The round waits until every living player is out of hands, then resolves once for
  the lobby.
- R23. Players are ranked by score. The bottom half (the player count divided by two,
  rounded down, at least one) lose a life. A tie at the cutoff folds into the losers. If
  the cutoff tie reaches the top score, the cut moves to just under the top. If everyone
  ties, nobody loses.
- R24. A game that started with more than two players keeps rank and cut even when only
  two are alive.
- R25. The match ends when one player is alive (that player wins) or none is (a draw).
- R26. The live target: a player the cut would spare sees the next-lower neighbour, and a
  player it would not spare sees the next-higher one. `safe` in `pvp.targets` says which.

### Nemesis pairing (more than two players)

- R27. Each ante, the living players are shuffled and paired. With an odd count one player
  gets a bye, preferably not the player who had the last bye. Pairs follow a round-robin
  with no repeated pair until every pair has been used, then the cycle restarts.
- R28. The pairing is made at the start of a run, and again on the first progress report
  with a higher ante than the last pairing. It is stored, so a re-tick or a death never
  re-pairs.
- R29. The round resolves once every living player is out of hands. In each living pair
  the lower score loses a guarded life, and a tie costs nobody. A pair whose partner is
  dead counts as a bye.
- R30. The match ends as in Royale (R25).

### Games of more than two players (Royale and Nemesis)

- R31. A player with 0 lives is shown as eliminated, and cannot Ready. The others do not
  wait for them, and a round that waited only on their Ready starts at once. A pending
  death that still waits keeps the player's result open.
- R32. Several pending deaths can be open at once. The match ends only when one survivor
  stands and every pending death has heard from every other present player who still has
  lives. Places: the survivor ranks first. A player who died or failed on a pending blind
  ranks lower for each such blind. A player who was out before a death, or who left
  without a result for it, drops two more for each such death. Ties share a place, and
  the next place skips the tied count.
- R33. A forfeit in a game of more than two players puts the forfeiter out of the run.
  Then the win check and the round resolution run without them.
- R34. A player who fails a round or runs out of time is put out of hands, in every mode
  except the duel, so the round does not wait on a hand count that will never move. The
  player's later hands in that round are stale.

### Manhunt

- R35. There is exactly one Runner. It is the first player, in start order, who picked
  RUNNER, or else the first player. Extra RUNNER picks become Hunters. Everyone else is a
  Hunter, whatever they picked.
- R36. The Runner has one life. Hunters have `manhunt_hunter_lives` (default 7).
- R37. The round resolves once every living player is out of hands.
- R38. A Hunter loses a life if they are behind the Runner, or tied with a Runner who
  scored more than 0. A tie at 0 to 0 costs nothing.
- R39. The Runner loses their life only if the best Hunter strictly beats them.
- R40. When the Runner has 0 lives, the Hunters win. When no Hunter is alive, the Runner
  wins.
- R41. A Runner who reaches ante 9 (above ante 8) wins.
- R42. When the Runner redeems an ante-skip voucher, every Hunter who is in the run with
  lives left gains one life.
- R43. If the Runner forfeits or leaves, the Hunters win, unless a team pending death is
  open. A Hunter who forfeits or leaves is out.
- R44. The Runner's target is the best-scoring Hunter in the run (ties go to the smaller
  id). Every Hunter targets the Runner.
- R45. A Runner who dies on a non-PvP blind opens a team pending death. A Hunter who
  beats that blind wins it for the Hunters. If every Hunter failed it, is out or is gone,
  it is a draw. A Hunter at 0 lives opens none.

### Teams

- R46. The matchmaker's team plan overrides picks. A player with a valid pick keeps it,
  and an unpicked player goes to the smaller team (ties to A).
- R47. Each team has one shared pool of lives, equal to the starting lives. Each member's
  lives mirror the pool. A non-PvP blind failed by several teammates costs the pool one life until a
  member moves on (R49).
- R48. The round resolves once every living player is out of hands. The team with the
  higher sum of scores wins. A tie costs nobody. The losing team's pool drops by one,
  once.
- R49. A team has one guard. The first non-PvP blind failure costs the team's pool one
  life and spends it; the guard stays spent for every teammate's failures, whatever
  blind they name, until any member's progress moves, which re-arms it. The client sends
  `pvp.progress` when it reaches an ante, selects a blind (`furthestBlind` = ante * 10
  + the blind index: Small 1, Big 2, Boss 3) or skips one. The server consumes failures
  and progress in the order they arrived, so a failure is charged before a later select.
  So A failing 3:Big, then B selecting 3:Big and failing it, costs two; A and B both
  selecting Big and both failing it costs one; A failing 3:Big, then B failing 3:Small
  before anyone selects a blind costs one. A lost PvP round is the team's: it costs the
  team one life and spends the blind's guard for every teammate. Failures of the PvP
  blind before the loss are each charged, and the loss then costs nothing more;
  failures after the loss cost nothing. An Ante-timer run-out costs the team a life for
  each timed player (R3). A pool never goes below 0.
- R50. When pool A or pool B reaches 0, the other team wins.
- R51. Each ante, every living player gets a random living member of the opposing team as
  their card target. The targets are stored, and are repaired after a forfeit or a leave.
- R52. A team whose members have all forfeited or left loses.
- R53. A team pool that reaches 0 on a non-PvP blind opens a team pending death, as in
  R45.
- R54. The live display shows the two team score sums.
- R55. A Royale or Nemesis game that started with three or more players and has exactly
  two seated players left (started seats that have not left the lobby; an eliminated
  player who is still seated counts) plays the duel round from then on: the round ends
  early when the trailing player is out of hands (R16-R18), and in Nemesis the two fight
  each other instead of one taking a bye. Pizza, Gambling and Asteroid reach the other
  one. Deaths, places and the win check stay the game's own. While three or more are
  seated, an eliminated player keeps the 3+ rules (the round waits for the survivors,
  Nemesis gives a bye). The mode is decided in one place (`pickMode`). Teams and
  Manhunt keep their own rules.
