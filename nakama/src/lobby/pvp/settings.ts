// The settings a PvP game starts with (docs/pvp-match.md section 4, `pvp.rules`), read
// from the host-written lobby metadata, and the checks on a blind key. Pure.
//
// The client always writes every key the rules freeze from (PVP.pvp_lobby_metadata),
// so a key that is missing or malformed is refused as bad_rules naming it; the server
// invents no default. The mode comes from queue_mode through the same flags as the
// client's PVP_GAMEMODES.
import type {
	AnteClock,
	ClockRules,
	PvpClockRules,
	PvpMode,
	PvpSettings,
} from './state'

// Death on a lost round is a constant of the game, not a lobby option.
const DEATH_ON_ROUND_LOSS = true

// queue_mode -> mode. Small World differs only in client content, so it plays
// the Royale rules. A queue mode not listed (or missing) has no mode: null.
const MODE_OF_QUEUE: { [queueMode: string]: PvpMode } = {
	pvp_nemesis: 'nemesis',
	pvp_experimental: 'nemesis',
	pvp_manhunt: 'manhunt',
	pvp_teams: 'teams',
	pvp_royale: 'royale',
	pvp_smallworld: 'royale',
}

export function modeOfQueue(queueMode: unknown): PvpMode | null {
	if (typeof queueMode !== 'string') return null
	return Object.prototype.hasOwnProperty.call(MODE_OF_QUEUE, queueMode)
		? MODE_OF_QUEUE[queueMode]
		: null
}

// A positive whole number from a number or a numeric string; else null.
function positiveInt(value: unknown): number | null {
	const n =
		typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

// "<ante>:<blind>", the key the client names a blind by (pvp.blind, pvp.ready).
// A negative or fractional ante is malformed: the request is a bad_payload.
const BLIND_KEY = /^(\d+):(Small|Big|Boss)$/

export function isBlindKey(value: unknown): value is string {
	return typeof value === 'string' && BLIND_KEY.test(value)
}

// A blind a player can skip: the Small or Big of an ante, never the Boss.
const SKIPPABLE_BLIND = /^(\d+):(Small|Big)$/

export function isSkippableBlind(value: unknown): value is string {
	return typeof value === 'string' && SKIPPABLE_BLIND.test(value)
}

// Ready is taken on any Boss blind: only the PvP blind shows a Ready button, and
// the ante cannot be checked here because a Manhunt voucher can lower it after the
// PvP Boss was set. `blindKey` passed isBlindKey.
export function isBossBlind(blindKey: string): boolean {
	return blindKey.endsWith(':Boss')
}

// The timer bank a start may claim and the base a server-counted timer restarts
// from: 10 s to 60 min (the lobby's `timer_base_seconds` is clamped to it too).
export const MIN_TIMER_MS = 10_000
export const MAX_TIMER_MS = 3_600_000
export const MAX_TIMER_FORGIVENESS = 9

// A finite number from a number or a numeric string; else null.
function finiteNumber(value: unknown): number | null {
	const n =
		typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// `value` as a whole number between `lo` and `hi`.
function clampedInt(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, Math.round(value)))
}

// The clock rules of every ruleset (docs/pvp-match.md section 8): the one table
// the Ante clock, the PvP hand timer and the personal clocks are read from. The
// host publishes the rolled ruleset to metadata.ruleset, never the layers. A
// ruleset not in the table has no clock rules: clockRowOf reports bad_rules and
// the start is refused (actions/registry.ts).
const PRESSURE = {
	kind: 'pressure',
	baseMultiplier: 2,
	timedRate: 2,
	previewCostMs: 3500,
} as const
const SPEEDLATRO = {
	kind: 'speedlatro',
	baseMs: 147_000,
	pvpMs: 73_500,
	graceMs: 4000,
	timedRate: 2,
	previewCostMs: 0,
} as const
const PVP_HAND_TIMER = { baseMs: 60_000, handMs: 10_000 } as const

// `ownSkips`: every own skip since the last PvP round adds the increment, not only
// the lead over the opponent (the client's majorleague layer).
// `forcedTimer`: a league ruleset forces the lobby's timers (the client's force_lobby_options):
// the frozen settings read these numbers, never the host's.
interface ClockRow {
	ante: AnteClock
	pvp: PvpClockRules | null
	personal: typeof PRESSURE | typeof SPEEDLATRO | null
	ownSkips: boolean
	forcedTimer: { baseSeconds: number; forgiveness: number } | null
}

// The row of a ruleset that has only the Ante bank.
const BANK_ONLY: ClockRow = {
	ante: 'bank',
	pvp: null,
	personal: null,
	ownSkips: false,
	forcedTimer: null,
}

const BANK_ONLY_RULESETS = [
	'ruleset_mp_experimental_legacy',
	'ruleset_mp_badlatro',
	'ruleset_mp_legacy_ranked',
	'ruleset_mp_sandbox',
	'ruleset_mp_smallworld',
	'ruleset_mp_vanilla',
	'ruleset_mp_wsob',
]

const CLOCK_EXCEPTIONS: { [ruleset: string]: ClockRow } = {
	ruleset_mp_experimental: {
		ante: 'personal',
		pvp: PVP_HAND_TIMER,
		personal: PRESSURE,
		ownSkips: false,
		forcedTimer: null,
	},
	ruleset_mp_balanced: { ...BANK_ONLY, pvp: PVP_HAND_TIMER },
	ruleset_mp_expanded: { ...BANK_ONLY, pvp: PVP_HAND_TIMER },
	ruleset_mp_speedlatro: {
		ante: 'personal',
		pvp: null,
		personal: SPEEDLATRO,
		ownSkips: false,
		forcedTimer: null,
	},
	ruleset_mp_chaos: {
		ante: 'personal',
		pvp: null,
		personal: SPEEDLATRO,
		ownSkips: false,
		forcedTimer: null,
	},
	// rulesets/majorleague.lua:11-12 and minorleague.lua:7-8 in the PvP mod.
	ruleset_mp_majorleague: {
		...BANK_ONLY,
		ownSkips: true,
		forcedTimer: { baseSeconds: 180, forgiveness: 0 },
	},
	ruleset_mp_minorleague: {
		...BANK_ONLY,
		forcedTimer: { baseSeconds: 210, forgiveness: 1 },
	},
	ruleset_mp_traditional: { ...BANK_ONLY, ante: 'none' },
}

const RULESET_CLOCKS: { [ruleset: string]: ClockRow } = {
	...Object.fromEntries(BANK_ONLY_RULESETS.map((id) => [id, BANK_ONLY])),
	...CLOCK_EXCEPTIONS,
}

// The ruleset ids the table knows (the H2 fixture test compares them with the mod's).
export function rulesetIds(): string[] {
	return Object.keys(RULESET_CLOCKS)
}

export type ClockRulesResult =
	| { ok: true; row: ClockRow }
	| { ok: false; reason: 'bad_rules' }

// The table row of a ruleset id; a missing or unknown id is bad_rules.
export function clockRowOf(ruleset: unknown): ClockRulesResult {
	if (
		typeof ruleset !== 'string' ||
		!Object.prototype.hasOwnProperty.call(RULESET_CLOCKS, ruleset)
	)
		return { ok: false, reason: 'bad_rules' }
	return { ok: true, row: RULESET_CLOCKS[ruleset] }
}

// The frozen clock rules of a game: the table row with the Pressure base resolved
// from the lobby's Ante base (`timerBaseMs`).
function clocksOf(row: ClockRow, timerBaseMs: number): ClockRules {
	const { ante, pvp, personal } = row
	if (personal === null) return { ante, pvp, personal: null }
	if (personal.kind === 'speedlatro') return { ante, pvp, personal }
	return {
		ante,
		pvp,
		personal: {
			kind: 'pressure',
			baseMs: timerBaseMs * personal.baseMultiplier,
			timedRate: personal.timedRate,
			previewCostMs: personal.previewCostMs,
		},
	}
}

function incrementMs(seconds: number | null): number | null {
	return seconds === null ? null : Math.max(0, Math.round(seconds * 1000))
}

// The lobby metadata keys the rules freeze from (docs/pvp-match.md section 4). A
// write that changes one of them is checked by `splitRulePatch`.
export const RULE_KEYS = [
	'ruleset',
	'queue_mode',
	'starting_lives',
	'manhunt_hunter_lives',
	'pvp_start_round',
	'timer_base_seconds',
	'timer_forgiveness',
	'timer_increment_seconds',
] as const

export type RuleKey = (typeof RULE_KEYS)[number]

export function isRuleKey(key: string): key is RuleKey {
	return (RULE_KEYS as readonly string[]).includes(key)
}

// Whether `value` is well formed for the rule key: a ruleset the clock table knows, a
// queue mode the server maps, a positive whole number of lives or ante, a finite
// timer number. `timer_increment_seconds` may also be null (no skip time).
export function ruleValueOk(key: RuleKey, value: unknown): boolean {
	switch (key) {
		case 'ruleset':
			return clockRowOf(value).ok
		case 'queue_mode':
			return (
				typeof value === 'string' &&
				Object.prototype.hasOwnProperty.call(MODE_OF_QUEUE, value)
			)
		case 'starting_lives':
		case 'manhunt_hunter_lives':
		case 'pvp_start_round':
			return positiveInt(value) !== null
		case 'timer_base_seconds':
		case 'timer_forgiveness':
			return finiteNumber(value) !== null
		case 'timer_increment_seconds':
			return value === null || finiteNumber(value) !== null
	}
}

// A metadata write of a refereed game, split per key (docs/pvp-match.md section 4).
// Before the freeze a rule key is accepted when its value is well formed; after it, a
// rule key may only be written with the value it has. Every other key is accepted.
export function splitRulePatch(
	patch: { [key: string]: unknown },
	current: { [key: string]: unknown },
	frozen: boolean,
): { accepted: { [key: string]: unknown }; refused: string[] } {
	const accepted: { [key: string]: unknown } = {}
	const refused: string[] = []
	for (const key of Object.keys(patch)) {
		const value = patch[key]
		const ok = !isRuleKey(key)
			? true
			: frozen
				? value === current[key]
				: ruleValueOk(key, value)
		if (ok) accepted[key] = value
		else refused.push(key)
	}
	return { accepted, refused }
}

export type SettingsResult =
	| { ok: true; settings: PvpSettings }
	| { ok: false; reason: 'bad_rules'; key: string }

// The settings to freeze for a game started by `startedIds` (the runId is added by
// the tick). A key that does not validate is a `bad_rules` result naming it; nothing
// is invented and nothing throws.
export function settingsFromMetadata(
	metadata: { [key: string]: unknown },
	startedIds: string[],
): SettingsResult {
	const found = clockRowOf(metadata.ruleset)
	if (!found.ok) return { ok: false, reason: 'bad_rules', key: 'ruleset' }
	const bad = (key: RuleKey): SettingsResult => ({
		ok: false,
		reason: 'bad_rules',
		key,
	})
	const mode = modeOfQueue(metadata.queue_mode)
	if (mode === null) return bad('queue_mode')
	const startingLives = positiveInt(metadata.starting_lives)
	if (startingLives === null) return bad('starting_lives')
	const hunterLives = positiveInt(metadata.manhunt_hunter_lives)
	if (hunterLives === null) return bad('manhunt_hunter_lives')
	const pvpStartAnte = positiveInt(metadata.pvp_start_round)
	if (pvpStartAnte === null) return bad('pvp_start_round')
	// A league ruleset forces both timers, so its lobby needs to carry neither.
	const forced = found.row.forcedTimer
	const baseSeconds = forced
		? forced.baseSeconds
		: finiteNumber(metadata.timer_base_seconds)
	if (baseSeconds === null) return bad('timer_base_seconds')
	const forgiveness = forced
		? forced.forgiveness
		: finiteNumber(metadata.timer_forgiveness)
	if (forgiveness === null) return bad('timer_forgiveness')
	// No skip time is a lobby that writes no increment, or null (never an invented 60 s).
	const rawIncrement = metadata.timer_increment_seconds ?? null
	const increment = rawIncrement === null ? null : finiteNumber(rawIncrement)
	if (rawIncrement !== null && increment === null)
		return bad('timer_increment_seconds')
	const timerBaseMs = clampedInt(baseSeconds * 1000, MIN_TIMER_MS, MAX_TIMER_MS)
	return {
		ok: true,
		settings: {
			mode,
			startedCount: startedIds.length,
			startingLives,
			hunterLives,
			pvpStartAnte,
			deathOnRoundLoss: DEATH_ON_ROUND_LOSS,
			clocks: clocksOf(found.row, timerBaseMs),
			// The host publishes the raw values (timer_base_seconds is not multiplied).
			timerBaseMs,
			timerIncrementMs: incrementMs(increment),
			skipTimeRule: found.row.ownSkips ? 'own' : 'lead',
			timerForgiveness: clampedInt(forgiveness, 0, MAX_TIMER_FORGIVENESS),
		},
	}
}
