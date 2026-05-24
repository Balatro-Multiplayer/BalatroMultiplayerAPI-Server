export class AppError extends Error {
	constructor(
		message: string,
		public statusCode: number = 500,
	) {
		super(message)
		this.name = 'AppError'
	}
}
