// The Staff role card: the role a player holds, and the privilege list a role
// pick turns into. Pure: the card holds the state.
export type StaffRoleChoice = 'player' | 'moderator' | 'admin'

export const ROLE_CHOICES: { key: StaffRoleChoice; label: string }[] = [
  { key: 'player', label: 'Player' },
  { key: 'moderator', label: 'Moderator' },
  { key: 'admin', label: 'Admin' },
]

const STAFF_PRIVILEGES = ['moderator', 'admin']

export function roleChoiceOf(privileges: readonly string[]): StaffRoleChoice {
  if (privileges.includes('admin')) return 'admin'
  if (privileges.includes('moderator')) return 'moderator'
  return 'player'
}

// The new privilege list: other privileges stay, the staff ones follow the pick.
export function privilegesFor(
  privileges: readonly string[],
  role: StaffRoleChoice
): string[] {
  const kept = privileges.filter((p) => !STAFF_PRIVILEGES.includes(p))
  return role === 'player' ? kept : [...kept, role]
}

// What a change may do: it needs a different role and a note.
export function roleChangeError(
  privileges: readonly string[],
  role: StaffRoleChoice,
  note: string
): string | null {
  if (role === roleChoiceOf(privileges)) return 'Pick a different role.'
  if (!note.trim()) return 'A role change needs a note.'
  return null
}
