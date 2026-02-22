import { describe, expect, it } from 'vitest'
import { AppError } from '../../utils/errors.js'

describe('AppError', () => {
	it('creates an error with message and default status 500', () => {
		const err = new AppError('Something broke')
		expect(err.message).toBe('Something broke')
		expect(err.statusCode).toBe(500)
		expect(err.name).toBe('AppError')
	})

	it('accepts a custom status code', () => {
		const err = new AppError('Not found', 404)
		expect(err.statusCode).toBe(404)
	})

	it('is an instance of Error', () => {
		const err = new AppError('test')
		expect(err).toBeInstanceOf(Error)
		expect(err).toBeInstanceOf(AppError)
	})
})
