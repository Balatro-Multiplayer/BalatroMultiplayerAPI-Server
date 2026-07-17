// Phase 8 anti-cheat plausibility gate. Separate from metrics.config.ts's
// per-metric bounds -- this one constant governs the elapsed-time check
// (matchmaking.service.ts's evaluateAntiCheat), a different responsibility
// than "what values is a client-reported metric allowed to take".

// Minimum physically possible time (ms) to select and score one hand. A
// player's reported result is implausible if the match's real elapsed time
// is less than their own hand_result event count times this constant.
export const MIN_MS_PER_HAND = 3000
