// The page a player sees after an in-game report: it opens once, shows the
// report, takes added detail, and lets the reporter Withdraw it until staff
// decide. Opened again later, it shows only "Submitted" (ADR 0011).
// Withdraw wins over a staff claim: the item closes whoever holds it.

export const WITHDRAWN_ACTION = 'withdrawn'

export interface ReportPageRow {
	id: number
	type: string
	reporterId: string
	status: string
	additionalDetail: string | null
	withdrawnAt: Date | null
	createdAt: Date
}

export interface ReportPageDeps<Tx> {
	getReport(id: number): Promise<ReportPageRow | null>
	// True for the one call that opened the page (it had not been opened).
	markPageOpened(id: number, now: Date): Promise<boolean>
	setAdditionalDetail(id: number, text: string): Promise<void>
	findQueueItem(reportId: number): Promise<{ id: number; status: string } | null>
	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
	// Closes the item with no action; false when it was no longer open.
	closeItem(tx: Tx, itemId: number, actor: string, now: Date): Promise<boolean>
	// Marks the report withdrawn and resolved; false when it was already withdrawn.
	markWithdrawn(tx: Tx, reportId: number, now: Date): Promise<boolean>
	recordWithdrawn(tx: Tx, itemId: number, actor: string): Promise<void>
	now(): Date
}

export type ReportPageState = 'open' | 'decided' | 'withdrawn'

export type ReportPage =
	| { submitted: true }
	| {
			submitted: false
			report: { type: string; createdAt: Date; additionalDetail: string | null; state: ReportPageState }
	  }

export type ReportPageRefusal =
	| 'not_found'
	| 'forbidden'
	| 'decided'
	| 'already_withdrawn'
	| 'invalid_detail'

export type ReportPageResult<T> = { ok: true; value: T } | { ok: false; refusal: ReportPageRefusal }

export const MAX_DETAIL = 2000

const fail = (refusal: ReportPageRefusal): { ok: false; refusal: ReportPageRefusal } => ({ ok: false, refusal })

function stateOf(report: ReportPageRow): ReportPageState {
	if (report.withdrawnAt) return 'withdrawn'
	return report.status === 'open' ? 'open' : 'decided'
}

export function createReportPageService<Tx>(deps: ReportPageDeps<Tx>) {
	async function ownReport(id: number, playerId: string): Promise<ReportPageResult<ReportPageRow>> {
		const report = await deps.getReport(id)
		if (!report) return fail('not_found')
		if (report.reporterId !== playerId) return fail('forbidden')
		return { ok: true, value: report }
	}

	return {
		// The first call gets the page; every later call gets "Submitted".
		async open(id: number, playerId: string): Promise<ReportPageResult<ReportPage>> {
			const own = await ownReport(id, playerId)
			if (!own.ok) return own
			if (!(await deps.markPageOpened(id, deps.now()))) return { ok: true, value: { submitted: true } }
			const { type, createdAt, additionalDetail } = own.value
			return { ok: true, value: { submitted: false, report: { type, createdAt, additionalDetail, state: stateOf(own.value) } } }
		},

		async addDetail(id: number, playerId: string, text: unknown): Promise<ReportPageResult<null>> {
			if (typeof text !== 'string' || text.length > MAX_DETAIL) return fail('invalid_detail')
			const own = await ownReport(id, playerId)
			if (!own.ok) return own
			if (stateOf(own.value) !== 'open') return fail('decided')
			await deps.setAdditionalDetail(id, text)
			return { ok: true, value: null }
		},

		// Closes the report's queue item with no action, claimed or not.
		async withdraw(id: number, playerId: string): Promise<ReportPageResult<null>> {
			const own = await ownReport(id, playerId)
			if (!own.ok) return own
			if (own.value.withdrawnAt) return fail('already_withdrawn')
			const item = await deps.findQueueItem(id)
			if (!item || item.status !== 'open') return fail('decided')
			const now = deps.now()
			const actor = `player:${playerId}`
			const closed = await deps.transaction(async (tx) => {
				if (!(await deps.closeItem(tx, item.id, actor, now))) return false
				if (!(await deps.markWithdrawn(tx, id, now))) throw new Error('report already withdrawn')
				await deps.recordWithdrawn(tx, item.id, actor)
				return true
			})
			return closed ? { ok: true, value: null } : fail('decided')
		},
	}
}

export type ReportPageService = ReturnType<typeof createReportPageService>
