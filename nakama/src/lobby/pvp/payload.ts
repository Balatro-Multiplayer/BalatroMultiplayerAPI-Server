// The checks every PvP request payload goes through before a reducer trusts it.
// The Ready reducers (ready.ts) and the fact reducers (facts.ts) share them.

export type Payload = { [key: string]: unknown }

export function isRecord(value: unknown): value is Payload {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A whole number from 0 to `max`.
export function isCount(
	value: unknown,
	max = Number.MAX_SAFE_INTEGER,
): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= max
	)
}

// A non-empty string of at most `max` characters.
export function isName(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= max
}
