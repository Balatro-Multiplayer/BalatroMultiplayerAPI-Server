import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { listRunChat } from '../../infrastructure/gateways/match-staff.gateway.js'

const dialect = new PgDialect()

describe('the match chat query', () => {
	async function whereOf(finalizedAt: Date | null, until: Date) {
		const wheres: unknown[] = []
		vi.mocked(db.select).mockImplementation((() => {
			const chain: any = {}
			for (const m of ['from', 'orderBy', 'limit'])
				chain[m] = vi.fn(() => chain)
			chain.where = vi.fn((condition: unknown) => {
				wheres.push(condition)
				return chain
			})
			chain.then = (resolve: (rows: unknown[]) => void) => resolve([])
			return chain
		}) as any)
		await listRunChat(
			{
				lobbyCode: 'BG1MB',
				startedAt: new Date('2026-11-01T10:00:00Z'),
				finalizedAt,
			},
			until,
		)
		return dialect.sqlToQuery(wheres[0] as any)
	}

	it("keeps only the match's lobby and its time window", async () => {
		const { sql, params } = await whereOf(
			new Date('2026-11-01T10:30:00Z'),
			new Date('2026-11-02T00:00:00Z'),
		)
		expect(sql).toContain('"lobby_code" = $1')
		expect(sql).toContain('"sent_at" >=')
		expect(sql).toContain('"sent_at" <=')
		expect(params[0]).toBe('BG1MB')
		expect(params).toContainEqual(new Date('2026-11-01T10:00:00Z'))
		expect(params).toContainEqual(new Date('2026-11-01T10:30:00Z'))
	})

	it('ends the window now for a run that is still going', async () => {
		const until = new Date('2026-11-02T00:00:00Z')
		const { params } = await whereOf(null, until)
		expect(params).toContainEqual(until)
	})
})
