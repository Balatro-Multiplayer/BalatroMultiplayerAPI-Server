# Balatro Multiplayer Server

TCP game server for [Balatro Multiplayer](https://github.com/Balatro-Multiplayer/BalatroMultiplayer). Handles lobby management, game state synchronization, and PvP logic between two players.

## Overview

- **Transport:** Raw TCP sockets on port `8788`, newline-delimited JSON messages
- **Protocol:** Each message is a JSON object followed by `\n`
- **Keep-alive:** Server sends `keepAlive` after 5s of inactivity, retries 3 times at 2.5s intervals before closing the connection
- **Security:** No TLS or client verification. The server operates on good faith that clients are not tampered with.

## Setup

```bash
npm install
npm run build
npm run start
```

### Message Flow

1. Client connects via TCP
2. Server sends `connected` and `version`
3. Client sends `username` with mod hash
4. Client creates or joins a lobby
5. Game actions flow between clients through the server
6. Server maintains authoritative state for lives, scores, and PvP outcomes

## Modded Actions

The modded action system allows third-party mods to use the server as a relay without needing dedicated server-side action handlers.

### How It Works

1. Client sends `moddedAction` with a `modId`, `modAction`, and arbitrary extra fields
2. Server validates the client is in a lobby
3. Server forwards the message to the target (`"nemesis"` for opponent only, `"all"` for both players)
4. The `target` field is stripped before relay; all other fields are forwarded as-is

### Client-Side API

**Sending** (at runtime):
```lua
-- Send to opponent (default)
MP.ACTIONS.modded("MyMod", "syncState", { hp = 20, damage = 5 })

-- Broadcast to all players in the lobby
MP.ACTIONS.modded("MyMod", "announce", { message = "hello" }, "all")
```

**Receiving** (at mod init time, top-level):
```lua
-- SMODS.current_mod.id is captured automatically during init
MP.register_mod_action("syncState", function(data)
    -- data.modId, data.modAction, and all custom fields are available
    update_state(data.hp, data.damage)
end)
```

### Wire Format

```json
{
    "action": "moddedAction",
    "modId": "MyMod",
    "modAction": "syncState",
    "target": "nemesis",
    "hp": 20,
    "damage": 5
}
```

### Notes

- `modId` should match the mod's SMODS ID
- Your mod must have an SMODS priority higher than `10000000` so that the Multiplayer mod (and `MP.register_mod_action`) is loaded before your mod's init runs
- `MP.register_mod_action` must be called at mod init time (top-level in your mod file) so `SMODS.current_mod` is available
- `MP.ACTIONS.modded` can be called at runtime with any `modId`, allowing cross-mod communication
- The server performs no validation on mod-specific fields; it is purely a relay
- Avoid using `action`, `modId`, `modAction`, or `target` as custom parameter names to prevent collisions

## Built In Actions

Format used below:

```
action_name: param1, param2, param3?
- Description
- param1: type - description
- param2: type - description
- param3?: type - optional param description
```

### Server to Client

**connected**
- Sent immediately on TCP connection

---

**version**
- Requests the client send its version for compatibility checking

---

**error:** message
- Sent when something goes wrong (invalid lobby code, lobby full, etc.)
- message: string - human-readable error

---

**joinedLobby:** code, type
- Confirms the client has joined a lobby
- code: string - 5-letter lobby code
- type: GameMode - the lobby's game mode

---

**lobbyInfo:** host, hostHash, hostCached, guest?, guestHash?, guestCached?, guestReady?, isHost
- Current lobby state, sent on lobby changes
- host: string - host's username
- hostHash: string - host's mod hash
- hostCached: boolean - whether host client is cached
- guest?: string - guest's username (if present)
- guestHash?: string - guest's mod hash
- guestCached?: boolean - whether guest client is cached
- guestReady?: boolean - whether guest is ready to start
- isHost: boolean - whether the receiving client is the host

---

**startGame:** deck, stake?, seed?
- Tells clients to start the run
- deck: string - deck or challenge ID
- stake?: number - stake level (1-8)
- seed?: string - shared seed (8 chars, uppercase + digits). Omitted when `different_seeds` is enabled.

---

**startBlind**
- Sent when both players are ready, begins the PvP blind

---

**playerInfo:** lives
- Updates the client on their own life count
- lives: number

---

**enemyInfo:** score, handsLeft, skips, lives
- Updates the client on their opponent's state
- score: string - total score (can be very large)
- handsLeft: number
- skips: number
- lives: number

---

**endPvP:** lost
- Sent at the end of a PvP blind
- lost: boolean - whether the receiving client lost

---

**winGame**
- Forces the client to win the run

---

**loseGame**
- Forces the client to lose the run

---

**stopGame**
- Returns clients to the lobby (sent when any client disconnects or leaves mid-game)

---

**lobbyOptions:** gamemode, ...options
- Syncs lobby options to the guest when host changes them
- gamemode: string
- Remaining fields are key-value lobby configuration options

---

**enemyLocation:** location
- Notifies the client of their opponent's current game location
- location: string

---

**speedrun**
- Sent to the first player who readies up (before the opponent), indicating they are in speedrun mode

---

**sendPhantom:** key
- Tells the client to create a phantom (ghost) copy of a joker
- key: string - joker ID

---

**removePhantom:** key
- Tells the client to remove a phantom joker
- key: string - joker ID

---

**asteroid**
- Triggers the asteroid event on the receiving client

---

**letsGoGamblingNemesis**
- Triggers the "Let's Go Gambling" nemesis effect on the receiving client

---

**eatPizza:** whole
- Triggers the pizza joker effect on the receiving client
- whole: boolean

---

**soldJoker**
- Notifies the client that their opponent sold a joker

---

**spentLastShop:** amount
- Notifies the client how much their opponent spent in the last shop
- amount: number

---

**magnet**
- Triggers the magnet joker effect, requesting a joker key from the opponent

---

**magnetResponse:** key
- Returns the selected joker for the magnet effect
- key: string - joker ID

---

**getEndGameJokers**
- Requests the opponent's joker list for end-game display

---

**receiveEndGameJokers:** keys
- Returns the joker list for end-game display
- keys: string - serialized joker keys

---

**getNemesisDeck**
- Requests the opponent's deck for nemesis display

---

**receiveNemesisDeck:** cards
- Returns the deck for nemesis display
- cards: string - serialized card data

---

**endGameStatsRequested**
- Requests end-game stats from the opponent

---

**nemesisEndGameStats:** reroll_count, reroll_cost_total, vouchers
- Returns end-game stats
- reroll_count: string
- reroll_cost_total: string
- vouchers: string

---

**startAnteTimer:** time
- Starts the ante timer on the receiving client
- time: number - timer value in seconds

---

**pauseAnteTimer:** time
- Pauses the ante timer on the receiving client
- time: number - current timer value

---

**moddedAction:** modId, modAction, ...params
- Relayed from another client via the modded action system (see [Modded Actions](#modded-actions))
- modId: string - the sending mod's ID
- modAction: string - the mod-specific action key
- Additional fields are arbitrary mod-specific data

---

**TCG Actions (Deprecated - use moddedAction instead):**
- **tcg_compatible** - confirms client TCG version is supported
- **tcgStartGame:** damage, starting - begins TCG game after betting
- **tcgPlayerStatus:** ...params - relays TCG player state
- **tcgStartTurn:** ...params - notifies it's the opponent's turn

### Client to Server

**username:** username, modHash
- Sets the client's display name and mod hash for compatibility checking
- username: string
- modHash: string

---

**version:** version
- Reports the client's mod version for compatibility checking
- version: string - semver format (e.g. "0.2.12-MULTIPLAYER")

---

**createLobby:** gameMode
- Creates a new lobby. Expects `joinedLobby` response.
- gameMode: GameMode

---

**joinLobby:** code
- Joins an existing lobby. Expects `joinedLobby` or `error` response.
- code: string - 5-letter lobby code

---

**leaveLobby**
- Leaves the current lobby. Also triggered on disconnect.

---

**lobbyInfo**
- Requests a `lobbyInfo` response for the current lobby

---

**readyLobby**
- Marks the client as ready to start the game

---

**unreadyLobby**
- Marks the client as not ready

---

**startGame**
- Host-only. Starts the game if the guest is in the lobby.

---

**readyBlind**
- Declares ready for the next blind. When both players are ready, server sends `startBlind`.

---

**unreadyBlind**
- Declares not ready for the next blind

---

**playHand:** score, handsLeft, hasSpeedrun
- Reports a played hand to the server. Server evaluates PvP outcomes when both players run out of hands.
- score: string - total cumulative score for the blind
- handsLeft: number
- hasSpeedrun: boolean

---

**stopGame**
- Returns all players to the lobby

---

**lobbyOptions:** ...options
- Host sends updated lobby options. Server stores and relays to guest.

---

**setLocation:** location
- Updates the client's current game location (relayed to opponent as `enemyLocation`)
- location: string

---

**setAnte:** ante
- Reports the client's current ante to the server
- ante: number

---

**setFurthestBlind:** furthestBlind
- Reports the furthest blind beaten (used in survival mode win conditions)
- furthestBlind: number

---

**skip:** skips
- Reports the client's skip count
- skips: number

---

**newRound**
- Resets the client's life-loss blocker for the new round

---

**failRound**
- Declares the client lost a round. Server may deduct a life depending on lobby options.

---

**failTimer**
- Declares the client ran out of time. Server deducts a life and may end the game.

---

**syncClient:** isCached
- Reports whether the client is running a cached/release build
- isCached: boolean

---

**sendPhantom:** key, **removePhantom:** key, **asteroid**, **letsGoGamblingNemesis**, **eatPizza:** whole, **soldJoker**, **spentLastShop:** amount, **magnet**, **magnetResponse:** key, **getEndGameJokers**, **receiveEndGameJokers:** keys, **getNemesisDeck**, **receiveNemesisDeck:** cards, **endGameStatsRequested**, **nemesisEndGameStats:** reroll_count, reroll_cost_total, vouchers, **startAnteTimer:** time, **pauseAnteTimer:** time
- These are all relay actions for multiplayer-specific joker and game effects. The server forwards them to the opponent without modification. See the Server to Client section for parameter details.

---

**moddedAction:** modId, modAction, target?, ...params
- Sends a mod-specific action through the server relay (see [Modded Actions](#modded-actions))
- modId: string - the target mod's ID
- modAction: string - the mod-specific action key
- target?: "nemesis" | "all" - who receives the relayed message (default: "nemesis")
- Additional fields are arbitrary mod-specific data, forwarded as-is

---

**TCG Actions (Deprecated - use moddedAction instead):**
- **tcgServerVersion:** version - reports TCG client version for compatibility
- **startTcgBetting** - host initiates TCG betting phase
- **tcgBet:** bet - places a TCG bet
- **tcgPlayerStatus:** ...params - sends TCG player state to opponent
- **tcgEndTurn:** ...params - ends TCG turn

### Utility

**keepAlive**
- Sent by the server to check if the connection is alive. Client should respond with `keepAliveAck`.

---

**keepAliveAck**
- Response to `keepAlive`.
