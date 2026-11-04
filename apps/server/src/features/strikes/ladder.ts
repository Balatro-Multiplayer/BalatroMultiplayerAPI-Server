// The strike ladder rules, as pure functions of plain data. A strike is one
// punishment on a ladder. It counts for 3 months, or until the punishment is
// lifted. The next step on the ladder is the recommended punishment.

export const LADDERS = ['chat', 'play'] as const
export type Ladder = (typeof LADDERS)[number]
export const isLadder = (value: unknown): value is Ladder =>
	typeof value === 'string' && (LADDERS as readonly string[]).includes(value)

export const LADDER_STEPS = [
	'warning',
	'24h',
	'7d',
	'30d',
	'permanent',
] as const
export type LadderStep = (typeof LADDER_STEPS)[number]
const isLadderStep = (value: unknown): value is LadderStep =>
	typeof value === 'string' &&
	(LADDER_STEPS as readonly string[]).includes(value)

export const DEFAULT_LADDER_STEPS: Readonly<
	Record<Ladder, readonly LadderStep[]>
> = {
	chat: ['warning', '24h', '7d', '30d', 'permanent'],
	play: ['warning', '24h', '7d', '30d', 'permanent'],
}

export const STRIKE_LIFETIME_MONTHS = 3
export const MAX_LADDER_STEPS = 8

export interface Strike {
	issuedAt: Date
	// When the strike's punishment was lifted; a warning is never lifted.
	liftedAt: Date | null
}

export function strikeStopsCountingAt(issuedAt: Date): Date {
	const end = new Date(issuedAt)
	end.setUTCMonth(end.getUTCMonth() + STRIKE_LIFETIME_MONTHS)
	return end
}

export function countingStrikes<T extends Strike>(
	strikes: readonly T[],
	now: Date,
): T[] {
	return strikes.filter(
		(s) => s.liftedAt === null && strikeStopsCountingAt(s.issuedAt) > now,
	)
}

// The step for the next punishment: the step after the strikes that count,
// and the last step once the ladder runs out.
export function recommendedStep(
	steps: readonly LadderStep[],
	strikes: readonly Strike[],
	now: Date,
): LadderStep {
	const index = Math.min(countingStrikes(strikes, now).length, steps.length - 1)
	return steps[index] as LadderStep
}

export type Punishment =
	| { kind: 'warning' }
	| { kind: 'ban'; duration: Exclude<LadderStep, 'warning'> }

export const appliedStepOf = (punishment: Punishment): LadderStep =>
	punishment.kind === 'warning' ? 'warning' : punishment.duration

const HOUR_MS = 3600 * 1000
const PRESET_MS = {
	'24h': 24 * HOUR_MS,
	'7d': 7 * 24 * HOUR_MS,
	'30d': 30 * 24 * HOUR_MS,
} as const
// A ban's end is set a moment after the form was filled in.
const PRESET_TOLERANCE_MS = HOUR_MS

// The step a ban's end date stands for: a preset length, permanent, or custom.
export function stepOfExpiry(
	expiresAt: Date | null,
	now: Date,
): Exclude<LadderStep, 'warning'> | 'custom' {
	if (expiresAt === null) return 'permanent'
	const length = expiresAt.getTime() - now.getTime()
	for (const [preset, ms] of Object.entries(PRESET_MS))
		if (Math.abs(length - ms) <= PRESET_TOLERANCE_MS)
			return preset as keyof typeof PRESET_MS
	return 'custom'
}

export type ParsedSteps =
	| { ok: true; steps: LadderStep[] }
	| { ok: false; message: string }

export function parseLadderSteps(value: unknown): ParsedSteps {
	if (!Array.isArray(value) || value.length === 0)
		return { ok: false, message: 'steps must be a list with at least one step' }
	if (value.length > MAX_LADDER_STEPS)
		return {
			ok: false,
			message: `steps has more than ${MAX_LADDER_STEPS} steps`,
		}
	if (!value.every(isLadderStep))
		return {
			ok: false,
			message: `each step must be one of ${LADDER_STEPS.join(', ')}`,
		}
	if (value[value.length - 1] !== 'permanent')
		return { ok: false, message: 'the last step must be permanent' }
	return { ok: true, steps: value }
}

export type AppliedStep = LadderStep | 'custom'

export type Judgement =
	| {
			ok: true
			recommended: LadderStep
			applied: AppliedStep
			deviationReason: string | null
	  }
	| { ok: false; message: string }

// Compares the punishment staff picked with the recommendation. A different
// pick needs a reason that explains why; both are kept.
export function judgePunishment(
	steps: readonly LadderStep[],
	strikes: readonly Strike[],
	now: Date,
	applied: AppliedStep,
	deviationReason: string | null,
): Judgement {
	const recommended = recommendedStep(steps, strikes, now)
	if (applied === recommended)
		return { ok: true, recommended, applied, deviationReason: null }
	const why = deviationReason?.trim()
	if (!why)
		return {
			ok: false,
			message: `the recommended step is ${recommended}; give a reason for ${applied}`,
		}
	return { ok: true, recommended, applied, deviationReason: why }
}
