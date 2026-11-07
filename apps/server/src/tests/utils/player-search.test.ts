import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { playerSearchCondition } from '../../features/webadmin/player-search.js'

const dialect = new PgDialect()
const UUID = '0b0c7a3e-1d5f-4c1a-9a55-5a7e3b9d1f20'

describe('playerSearchCondition', () => {
	it('matches a part of the name', () => {
		const { sql, params } = dialect.sqlToQuery(playerSearchCondition('ann')!)
		expect(sql).toContain('"steam_name" ilike')
		expect(sql).not.toContain('"nakama_user_id"')
		expect(params).toEqual(['%ann%'])
	})

	it('matches a player id or a Nakama id exactly', () => {
		const { sql, params } = dialect.sqlToQuery(playerSearchCondition(UUID)!)
		expect(sql).toContain('"players"."id" =')
		expect(sql).toContain('"nakama_user_id" =')
		expect(params).toEqual(expect.arrayContaining([UUID]))
	})

	it('adds no condition for an empty search', () => {
		expect(playerSearchCondition('')).toBeUndefined()
	})
})
