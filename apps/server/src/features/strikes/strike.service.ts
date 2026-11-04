// What the routes need from the strike ladders: the summary staff see, and the
// judgement of a punishment given from the player page.
import {
	getLadderSteps,
	listStrikes,
} from '../../infrastructure/gateways/strike.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import {
	type AppliedStep,
	LADDERS,
	type Ladder,
	type LadderStep,
	countingStrikes,
	judgePunishment,
	recommendedStep,
	strikeStopsCountingAt,
} from './ladder.js'

export interface LadderSummary {
	steps: readonly LadderStep[]
	// The step the next punishment on this ladder should be.
	recommended: LadderStep
	// The strikes that count now, with the date each stops counting.
	counting: {
		id: string
		appliedStep: AppliedStep
		recommendedStep: LadderStep
		deviationReason: string | null
		issuedAt: Date
		stopsCountingAt: Date
	}[]
}

export async function strikeSummaryOf(
	playerId: string,
	now: Date = new Date(),
): Promise<Record<Ladder, LadderSummary>> {
	const [steps, strikes] = await Promise.all([
		getLadderSteps(),
		listStrikes(playerId),
	])
	const summary = {} as Record<Ladder, LadderSummary>
	for (const ladder of LADDERS) {
		const mine = strikes.filter((s) => s.ladder === ladder)
		summary[ladder] = {
			steps: steps[ladder],
			recommended: recommendedStep(steps[ladder], mine, now),
			counting: countingStrikes(mine, now).map((s) => ({
				id: s.id,
				appliedStep: s.appliedStep,
				recommendedStep: s.recommendedStep,
				deviationReason: s.deviationReason,
				issuedAt: s.issuedAt,
				stopsCountingAt: strikeStopsCountingAt(s.issuedAt),
			})),
		}
	}
	return summary
}

// For a route: judge a punishment before it is written, or answer 400.
export async function judgeOnLadder(
	playerId: string,
	ladder: Ladder,
	applied: AppliedStep,
	deviationReason: string | null,
	now: Date,
) {
	const [steps, strikes] = await Promise.all([
		getLadderSteps(),
		listStrikes(playerId),
	])
	const judgement = judgePunishment(
		steps[ladder],
		strikes.filter((s) => s.ladder === ladder),
		now,
		applied,
		deviationReason,
	)
	if (!judgement.ok) throw new AppError(judgement.message, 400)
	return judgement
}
