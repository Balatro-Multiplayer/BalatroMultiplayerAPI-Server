// How long a client has to answer a challenge before it counts as a timeout.
export const CHALLENGE_TIMEOUT_MS = 15_000

// Periodic re-challenge interval is randomized within this window (jittered,
// not fixed) so the interval itself can't be used to predict/evade a check.
export const PERIODIC_MIN_MS = 5 * 60 * 1000
export const PERIODIC_MAX_MS = 20 * 60 * 1000

// Grace delay between EMQX's client.connected webhook firing and the server
// issuing the login challenge, giving the client's own SUBSCRIBE to
// player/{id}/challenge time to land first -- this is a non-retained publish,
// so a challenge sent before the client subscribes is simply lost.
export const LOGIN_CHALLENGE_DELAY_MS = 2_000
