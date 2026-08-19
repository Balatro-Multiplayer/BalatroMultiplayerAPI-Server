// How long a client has to answer a *periodic* challenge before it counts as
// a timeout. By this point in a session the loopback (mod<->launcher) and
// MQTT (mod<->server) channels are both already established, so 15s is
// comfortably generous.
export const CHALLENGE_TIMEOUT_MS = 15_000

// The *login* challenge is issued the moment the mod's MQTT CONNECT lands
// (see emqx.route.ts's handleClientConnected), which can race the mod's own
// RankedSupervisor loopback handshake to the launcher -- that handshake alone
// has its own 20s timeout on Windows/macOS (10s on Linux's discovery-file
// path; see rankedsupervisor.cpp), before any of the mod's own Steam-ticket
// auth or MQTT connect time is even counted. Using the shorter periodic
// timeout here could fail a perfectly legitimate first launch purely on
// startup ordering, not a real integrity problem -- so login gets its own,
// longer allowance instead of sharing periodic's.
export const LOGIN_CHALLENGE_TIMEOUT_MS = 30_000

// Periodic re-challenge interval is randomized within this window (jittered,
// not fixed) so the interval itself can't be used to predict/evade a check.
export const PERIODIC_MIN_MS = 3 * 60 * 1000
export const PERIODIC_MAX_MS = 5 * 60 * 1000

// Grace delay between EMQX's client.connected webhook firing and the server
// issuing the login challenge, giving the client's own SUBSCRIBE to
// player/{id}/challenge time to land first -- this is a non-retained publish,
// so a challenge sent before the client subscribes is simply lost.
export const LOGIN_CHALLENGE_DELAY_MS = 2_000
