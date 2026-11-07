import type { Request } from 'express'
import { requireRole } from './staff-role.js'

// Admin-only, not admin-or-moderator: for actions with a wide blast radius.
export async function requireAdmin(req: Request): Promise<void> {
	await requireRole(req, 'admin')
}
