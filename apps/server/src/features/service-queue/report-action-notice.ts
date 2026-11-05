// Tells a report's reporter that staff acted on the player they reported. The
// report keeps one mark, so a reopened item that is punished again says
// nothing; a dismissed item never takes the mark, so a punishment after a
// reopen still tells once.
export interface ReportActionNoticeDeps {
	// True for the one call that takes the mark.
	takeMark(reportId: number): Promise<boolean>
	giveMarkBack(reportId: number): Promise<void>
	send(reporterId: string): Promise<boolean>
}

export async function tellReporterOnce(deps: ReportActionNoticeDeps, reportId: number, reporterId: string): Promise<boolean> {
	if (!(await deps.takeMark(reportId))) return false
	const told = await deps.send(reporterId).catch(() => false)
	if (!told) await deps.giveMarkBack(reportId)
	return told
}
