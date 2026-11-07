import { desc, eq } from 'drizzle-orm'
import {
	type AppliedStep,
	DEFAULT_LADDER_STEPS,
	type Ladder,
	type LadderStep,
	type Strike,
	parseLadderSteps,
} from '../../features/strikes/ladder.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { playerBans, playerStrikes, playerWarnings, serverConfig } from '../db/schema.js'

export interface StrikeRecord extends Strike {
	id: string
	playerId: string
	ladder: Ladder
	banId: string | null
	warningId: string | null
	recommendedStep: LadderStep
	appliedStep: AppliedStep
	deviationReason: string | null
}

// The steps of both ladders: the admin's edit, else the defaults.
export async function getLadderSteps(
	exec: DbExecutor = db,
): Promise<Record<Ladder, readonly LadderStep[]>> {
	const [row] = await exec.select().from(serverConfig).limit(1)
	const stored = (value: unknown, ladder: Ladder) => {
		const parsed = parseLadderSteps(value)
		return parsed.ok ? parsed.steps : DEFAULT_LADDER_STEPS[ladder]
	}
	return {
		chat: stored(row?.chatLadderSteps, 'chat'),
		play: stored(row?.playLadderSteps, 'play'),
	}
}

export async function setLadderSteps(
	exec: DbExecutor,
	ladder: Ladder,
	steps: readonly LadderStep[],
): Promise<void> {
	const column =
		ladder === 'chat' ? { chatLadderSteps: steps } : { playLadderSteps: steps }
	await exec
		.insert(serverConfig)
		.values({ id: 1, ...column })
		.onConflictDoUpdate({
			target: serverConfig.id,
			set: { ...column, updatedAt: new Date() },
		})
}

export async function insertStrike(
	exec: DbExecutor,
	data: {
		playerId: string
		ladder: Ladder
		banId: string | null
		warningId: string | null
		recommendedStep: LadderStep
		appliedStep: AppliedStep
		deviationReason: string | null
		issuedAt?: Date
	},
): Promise<void> {
	await exec.insert(playerStrikes).values(data)
}

// Every strike of a player, newest first, with the lift time of its ban or warning.
export async function listStrikes(
	playerId: string,
	exec: DbExecutor = db,
): Promise<StrikeRecord[]> {
	const rows = await exec
		.select({
			strike: playerStrikes,
			banLiftedAt: playerBans.liftedAt,
			warningLiftedAt: playerWarnings.liftedAt,
		})
		.from(playerStrikes)
		.leftJoin(playerBans, eq(playerBans.id, playerStrikes.banId))
		.leftJoin(playerWarnings, eq(playerWarnings.id, playerStrikes.warningId))
		.where(eq(playerStrikes.playerId, playerId))
		.orderBy(desc(playerStrikes.issuedAt))
	return rows.map(({ strike, banLiftedAt, warningLiftedAt }) => ({
		...strike,
		ladder: strike.ladder as Ladder,
		recommendedStep: strike.recommendedStep as LadderStep,
		appliedStep: strike.appliedStep as AppliedStep,
		liftedAt: banLiftedAt ?? warningLiftedAt,
	}))
}

// What a punishment on one ladder is judged against: the ladder's steps and
// the player's strikes on it.
export async function ladderStateOf(playerId: string, ladder: Ladder) {
	const [steps, strikes] = await Promise.all([
		getLadderSteps(),
		listStrikes(playerId),
	])
	return {
		steps: steps[ladder],
		strikes: strikes.filter((s) => s.ladder === ladder),
	}
}
