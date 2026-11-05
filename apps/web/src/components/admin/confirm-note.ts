export function cleanNote(note: string): string {
  return note.trim()
}

// The note is the staff log reason: it must hold text, and a send in flight
// blocks a second one.
export function canSendConfirm(note: string, pending: boolean): boolean {
  return !pending && cleanNote(note).length > 0
}
