// How long a client has to answer a *periodic* challenge before it counts as
// a timeout. By this point in a session the loopback (mod<->launcher) and
// Nakama socket (mod<->server) are both already established, so 15s is
// comfortably generous.
export const CHALLENGE_TIMEOUT_MS = 15_000

// The *login* challenge is issued the moment the mod's Nakama socket opens
// (see handleClientConnected), which can race the mod's own
// RankedSupervisor loopback handshake to the launcher -- that handshake alone
// has its own 20s timeout on Windows/macOS (10s on Linux's discovery-file
// path; see rankedsupervisor.cpp), before any of the mod's own Steam-ticket
// auth or socket connect time is even counted. Using the shorter periodic
// timeout here could fail a perfectly legitimate first launch purely on
// startup ordering, not a real integrity problem -- so login gets its own,
// longer allowance instead of sharing periodic's.
export const LOGIN_CHALLENGE_TIMEOUT_MS = 30_000

// The *ranked_readiness* challenge is issued the moment a player joins the
// Ranked queue, and the launcher answers it only after forcing a fresh check
// of its own version and every active Ranked-legal mod's on-disk hash. That
// can take a while on a slow connection or disk, and the launcher's own
// fallback timer starts later than this one (the challenge still has to reach
// it through Nakama and the mod), so it gets the same generous allowance as
// login rather than periodic's 15s.
export const RANKED_READINESS_CHALLENGE_TIMEOUT_MS = 30_000

// Periodic re-challenge interval is randomized within this window (jittered,
// not fixed) so the interval itself can't be used to predict/evade a check.
export const PERIODIC_MIN_MS = 3 * 60 * 1000
export const PERIODIC_MAX_MS = 5 * 60 * 1000

// Delay before re-checking a verified player whose last check found them
// offline. Nakama's verdict expires 6 minutes after the last pass, so waiting
// a full periodic slot (3 to 5 minutes) could leave a player whose socket
// just reopened unverified for minutes. A short retry restores the verdict
// soon after they return.
export const OFFLINE_RETRY_MS = 30 * 1000

// How long a verified player may stay offline (first missed check to now)
// before the check session ends. A dropped socket usually returns within
// minutes, so the session must survive that. After an hour the player is
// gone for practical purposes, and ending the session caps the retry timer
// chain for a player who never returns. A new login starts a fresh session.
export const MAX_OFFLINE_MS = 60 * 60 * 1000
