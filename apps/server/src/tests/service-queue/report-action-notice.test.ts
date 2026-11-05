import { describe, expect, it, vi } from 'vitest'
import { tellReporterOnce } from '../../features/service-queue/report-action-notice.js'

function world(sendOk = true) {
	const marks = new Set<number>()
	const send = vi.fn(async () => sendOk)
	return {
		marks,
		send,
		deps: {
			takeMark: async (id: number) => !marks.has(id) && !!marks.add(id),
			giveMarkBack: async (id: number) => void marks.delete(id),
			send,
		},
	}
}

describe('tellReporterOnce', () => {
	it('tells the reporter on the first punishment only', async () => {
		const w = world()
		expect(await tellReporterOnce(w.deps, 7, 'rep')).toBe(true)
		// Reopened, then punished again.
		expect(await tellReporterOnce(w.deps, 7, 'rep')).toBe(false)
		expect(w.send).toHaveBeenCalledTimes(1)
		expect(w.send).toHaveBeenCalledWith('rep')
	})

	it('tells once after a dismiss, reopen and punishment (a dismiss never takes the mark)', async () => {
		const w = world()
		expect(w.marks.has(7)).toBe(false)
		expect(await tellReporterOnce(w.deps, 7, 'rep')).toBe(true)
		expect(w.send).toHaveBeenCalledTimes(1)
	})

	it('keeps each report apart', async () => {
		const w = world()
		await tellReporterOnce(w.deps, 1, 'a')
		expect(await tellReporterOnce(w.deps, 2, 'b')).toBe(true)
	})

	it('gives the mark back when the send fails, so a later punishment tries again', async () => {
		const w = world(false)
		expect(await tellReporterOnce(w.deps, 7, 'rep')).toBe(false)
		expect(w.marks.has(7)).toBe(false)
	})
})
