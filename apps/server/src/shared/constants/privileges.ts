import { PRIVILEGE_JOKERS } from './jokers.js'

export interface PrivilegeTable {
	jokers?: string[]
}

export function buildPrivilegeTable(privileges: string[]): PrivilegeTable {
	const jokers: string[] = []

	for (const priv of privileges) {
		const joker = PRIVILEGE_JOKERS.get(priv)
		if (joker) jokers.push(joker)
	}

	if (jokers.length === 0) return {}

	return { jokers }
}
