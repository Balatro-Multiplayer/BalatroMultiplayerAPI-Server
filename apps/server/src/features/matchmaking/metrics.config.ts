// Secondary leaderboard metrics — per-mod personal-best stats tracked alongside Elo
// rating (rating stays the leaderboard sort key; this rides along for display).
//
// This registry is the single source of truth for how a mod's secondary metric behaves.
// Adding a new mod's board is a one-line edit here.

export type MetricKind = 'score' | 'time_ms'

export interface MetricConfig {
	kind: MetricKind
	// 'desc' = higher is better (score). 'asc' = lower is better (time).
	direction: 'asc' | 'desc'
	// When true, the value is measured from the server clock (run start → result) and any
	// client-supplied placement metric is ignored. When false, the value is taken from the
	// client-reported placement metric (plausibility-bounded, never re-simulated).
	serverMeasured: boolean
}

export const METRIC_CONFIG: Record<string, MetricConfig> = {
	// PvP: season-high score, client-reported.
	MultiplayerPvP: { kind: 'score', direction: 'desc', serverMeasured: false },
	// §11.7/§16.8: season-best INDIVIDUAL run time, client-reported. A single
	// match can contain multiple runs (e.g. White Stake Triple's best-of-3), so
	// the server's one whole-match gameStartedAt timestamp can't measure this --
	// only the client knows each individual run's own start/stop.
	MultiplayerSpeedrunning: { kind: 'time_ms', direction: 'asc', serverMeasured: false },
}

export function getMetricConfig(modId: string): MetricConfig | undefined {
	return METRIC_CONFIG[modId]
}

// Plausibility bounds — the only guard on client-influenced values in this lightweight
// (no re-simulation) model. Values outside the range are rejected, not clamped.
const BOUNDS: Record<MetricKind, { min: number; max: number }> = {
	// Scores below 0 are impossible; cap stays within IEEE-754 / bigint-safe integer range.
	score: { min: 0, max: 1e15 },
	// A legitimate ranked run can't complete in under 10s nor take longer than 6h.
	time_ms: { min: 10_000, max: 6 * 60 * 60 * 1000 },
}

export function withinMetricBounds(kind: MetricKind, value: number): boolean {
	const b = BOUNDS[kind]
	return Number.isFinite(value) && value >= b.min && value <= b.max
}

// True if `candidate` is a strictly better personal best than `current` for this board.
export function isBetterMetric(
	cfg: MetricConfig,
	candidate: number,
	current: number | null | undefined,
): boolean {
	if (current === null || current === undefined) return true
	return cfg.direction === 'asc' ? candidate < current : candidate > current
}
