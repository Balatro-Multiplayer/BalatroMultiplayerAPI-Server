import { describe, expect, it } from 'vitest'
import {
	allowedActionsFor,
	itemTypesVisibleTo,
	permissionFor,
} from '../../features/service-queue/permissions.js'

const open = { itemType: 'staff_report', status: 'open' } as const

describe('staff report items', () => {
	it('are for admins only', () => {
		expect(itemTypesVisibleTo('moderator')).not.toContain('staff_report')
		expect(itemTypesVisibleTo('admin')).toContain('staff_report')
		expect(allowedActionsFor(open, 'moderator')).toEqual([])
		expect(permissionFor('dismiss', open, 'moderator')).toEqual({
			ok: false,
			refusal: 'forbidden',
		})
	})

	it('let an admin dismiss, note and void', () => {
		const actions = allowedActionsFor(open, 'admin').map((a) => a.action)
		expect(actions).toEqual(
			expect.arrayContaining(['dismiss', 'resolve', 'void', 'note']),
		)
	})
})
