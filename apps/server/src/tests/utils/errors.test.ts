import { describe, expect, it } from 'vitest'
import {
	AppError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from '../../shared/utils/errors.js'

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

describe('ValidationError', () => {
	it('defaults to statusCode 400', () => {
		const err = new ValidationError('bad input')
		expect(err.statusCode).toBe(400)
		expect(err.name).toBe('ValidationError')
		expect(err).toBeInstanceOf(AppError)
	})
})

describe('NotFoundError', () => {
	it('defaults to statusCode 404', () => {
		const err = new NotFoundError('missing')
		expect(err.statusCode).toBe(404)
		expect(err.name).toBe('NotFoundError')
		expect(err).toBeInstanceOf(AppError)
	})
})

describe('ForbiddenError', () => {
	it('defaults to statusCode 403', () => {
		const err = new ForbiddenError('nope')
		expect(err.statusCode).toBe(403)
		expect(err.name).toBe('ForbiddenError')
		expect(err).toBeInstanceOf(AppError)
	})
})
