import { describe, expect, it } from 'vitest'
import { isOwnerId, staffRoleOf } from '../../shared/utils/staff-role.js'

describe('the staff role check', () => {
	it('reads the role from the privileges, admin first', () => {
		expect(staffRoleOf('p1', [], '')).toBeNull()
		expect(staffRoleOf('p1', ['tester'], '')).toBeNull()
		expect(staffRoleOf('p1', ['moderator'], '')).toBe('moderator')
		expect(staffRoleOf('p1', ['admin'], '')).toBe('admin')
		expect(staffRoleOf('p1', ['moderator', 'admin'], '')).toBe('admin')
	})

	it('counts the owner as an admin whatever their privileges', () => {
		expect(staffRoleOf('owner', [], 'owner')).toBe('admin')
		expect(staffRoleOf('owner', ['moderator'], 'owner')).toBe('admin')
		expect(staffRoleOf('other', [], 'owner')).toBeNull()
	})

	it('has no owner while the id is unset', () => {
		expect(isOwnerId('', '')).toBe(false)
		expect(isOwnerId('owner', 'owner')).toBe(true)
		expect(isOwnerId('other', 'owner')).toBe(false)
	})
})
