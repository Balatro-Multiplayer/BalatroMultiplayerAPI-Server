import { AppError } from './errors.js'

export function parseExpiresAt(value: unknown): Date | null {
	if (value === null || value === undefined) return null
	if (typeof value !== 'string') throw new AppError('expiresAt must be an ISO8601 string or null', 400)
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) throw new AppError('expiresAt is not a valid date', 400)
	if (date.getTime() <= Date.now()) throw new AppError('expiresAt must be in the future', 400)
	return date
}
